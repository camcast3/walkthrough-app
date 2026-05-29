<#
.SYNOPSIS
  POST local page files to the intake server.

.DESCRIPTION
  Finds page*.json or page*.md files in the given walkthrough directory
  and POSTs each one to the running intake server.

  Searches in order:
    1. <Dir>/.intake/pages/  (where the server stores captured pages)
    2. <Dir>/                (if pages were placed at the top level)

  - page*.json files: POSTed directly (expected shape: { title, url, markdown })
  - page*.md files:   wrapped in JSON with a generated title, then POSTed

.PARAMETER Dir
  Path to the walkthrough directory.

.PARAMETER Server
  Intake server URL. Defaults to http://localhost:3847.

.EXAMPLE
  .\tools\intake\scripts\seed-pages.ps1 -Dir walkthroughs\trails-of-cold-steel-ii

.EXAMPLE
  .\tools\intake\scripts\seed-pages.ps1 -Dir walkthroughs\my-game -Server http://localhost:4000
#>

param(
  [Parameter(Mandatory=$true, Position=0)]
  [string]$Dir,

  [Parameter(Position=1)]
  [string]$Server = "http://localhost:3847"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Dir -PathType Container)) {
  Write-Error "Directory '$Dir' does not exist."
  exit 1
}

# Determine where the page files live
$searchDirs = @(
  (Join-Path $Dir ".intake\pages"),
  $Dir
)

$pages = $null
$mode = $null
$sourceDir = $null

foreach ($d in $searchDirs) {
  if (-not (Test-Path $d -PathType Container)) { continue }

  $found = Get-ChildItem -Path $d -Filter "page*.json" |
    Sort-Object { [int]($_.BaseName -replace 'page','') }
  if ($found.Count -gt 0) {
    $pages = $found
    $mode = "json"
    $sourceDir = $d
    break
  }

  $found = Get-ChildItem -Path $d -Filter "page*.md" |
    Sort-Object { [int]($_.BaseName -replace 'page','') }
  if ($found.Count -gt 0) {
    $pages = $found
    $mode = "md"
    $sourceDir = $d
    break
  }
}

if ($null -eq $pages -or $pages.Count -eq 0) {
  Write-Error "No page*.json or page*.md files found in '$Dir' or '$Dir\.intake\pages\'."
  exit 1
}

Write-Host "Found $($pages.Count) $mode page files in $sourceDir"
Write-Host ""

$count = 0
foreach ($page in $pages) {
  $num = $page.BaseName -replace 'page',''

  if ($mode -eq "json") {
    $body = Get-Content $page.FullName -Raw
  } else {
    $md = Get-Content $page.FullName -Raw
    $body = @{
      title    = "Page $num"
      url      = "file://$($page.Name)"
      markdown = $md
    } | ConvertTo-Json
  }

  Invoke-RestMethod -Method Post -Uri "$Server/api/intake" -ContentType 'application/json' -Body $body | Out-Null

  $count++
  Write-Host "  OK: $($page.Name) (page $num)"
}

Write-Host ""
Write-Host "Seeded $count pages to $Server"
Write-Host "Verify: (Invoke-RestMethod $($Server)/api/pages).Count"
