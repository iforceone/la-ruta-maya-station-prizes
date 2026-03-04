param(
  [Parameter(Mandatory=$true)][string]$WorkbookPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (!(Test-Path -LiteralPath $WorkbookPath)) {
  throw "Workbook not found: $WorkbookPath"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::OpenRead($WorkbookPath)

function Get-EntryXml([string]$name) {
  $entry = $zip.GetEntry($name)
  if (-not $entry) { return $null }

  $reader = New-Object IO.StreamReader($entry.Open())
  $text = $reader.ReadToEnd()
  $reader.Dispose()

  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  return [xml]$text
}

function Get-CellValue($cell, $sharedStrings) {
  $cellType = ''
  if ($null -ne $cell.PSObject.Properties['t']) {
    $cellType = [string]$cell.t
  }
  $vNode = $cell.SelectSingleNode('./*[local-name()="v"]')
  $isNode = $cell.SelectSingleNode('./*[local-name()="is"]')

  if ($cellType -eq 's' -and $vNode) {
    $idx = [int]$vNode.InnerText
    if ($idx -ge 0 -and $idx -lt $sharedStrings.Count) {
      return [string]$sharedStrings[$idx]
    }
    return ''
  }

  if ($cellType -eq 'inlineStr' -and $isNode) {
    $tNodes = $isNode.SelectNodes('.//*[local-name()="t"]')
    $parts = @()
    foreach ($tn in $tNodes) {
      $parts += $tn.InnerText
    }
    return ($parts -join '').Trim()
  }

  if ($vNode) {
    return [string]$vNode.InnerText
  }

  return ''
}

$workbookXml = Get-EntryXml 'xl/workbook.xml'
$relsXml = Get-EntryXml 'xl/_rels/workbook.xml.rels'
$sharedXml = Get-EntryXml 'xl/sharedStrings.xml'

$shared = @()
if ($sharedXml -and $sharedXml.sst -and $sharedXml.sst.si) {
  foreach ($si in $sharedXml.sst.si) {
    $hasT = $null -ne $si.PSObject.Properties['t']
    $hasR = $null -ne $si.PSObject.Properties['r']

    if ($hasT) {
      $siT = $si.t
      if ($siT -is [string]) {
        $shared += $siT
      }
      else {
        $shared += $siT.InnerText
      }
      continue
    }

    if ($hasR) {
      $parts = @()
      foreach ($run in $si.r) {
        $runHasT = $null -ne $run.PSObject.Properties['t']
        if (-not $runHasT) { continue }

        if ($run.t -is [string]) {
          $parts += $run.t
        }
        else {
          $parts += $run.t.InnerText
        }
      }
      $shared += ($parts -join '')
      continue
    }

    $shared += ''
  }
}

$relMap = @{}
foreach ($rel in $relsXml.Relationships.Relationship) {
  $relMap[$rel.Id] = $rel.Target
}

$sheetsOut = @()
foreach ($sheet in $workbookXml.workbook.sheets.sheet) {
  $sheetName = $sheet.GetAttribute('name')
  $rid = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  $target = $relMap[$rid]

  if (-not $target) { continue }
  if ($target -notmatch '^xl/') { $target = "xl/$target" }

  $sheetXml = Get-EntryXml $target
  if (-not $sheetXml -or -not $sheetXml.worksheet -or -not $sheetXml.worksheet.sheetData) { continue }

  $rowsOut = @()

  foreach ($row in $sheetXml.worksheet.sheetData.row) {
    $rowNumber = [int]$row.r

    $a = ''
    $b = ''
    $c = ''
    $d = ''
    $e = ''
    $f = ''

    foreach ($cell in $row.c) {
      $ref = [string]$cell.r
      $col = ($ref -replace '\d', '')
      $val = (Get-CellValue $cell $shared).Trim()

      switch ($col) {
        'A' { $a = $val }
        'B' { $b = $val }
        'C' { $c = $val }
        'D' { $d = $val }
        'E' { $e = $val }
        'F' { $f = $val }
      }
    }

    if ((($a + $b + $c + $d + $e + $f).Trim()).Length -eq 0) {
      continue
    }

    $rowsOut += [PSCustomObject]@{
      rowNumber = $rowNumber
      a = $a
      b = $b
      c = $c
      d = $d
      e = $e
      f = $f
    }
  }

  $sheetsOut += [PSCustomObject]@{
    name = $sheetName
    rows = $rowsOut
  }
}

$zip.Dispose()

$result = [PSCustomObject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  workbook = (Resolve-Path -LiteralPath $WorkbookPath).Path
  sheets = $sheetsOut
}

$result | ConvertTo-Json -Depth 8
