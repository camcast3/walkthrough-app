<#
.SYNOPSIS
  POST local page files to the intake server.

.DESCRIPTION
  Finds all page*.md or page*.json files in the given walkthrough directory
  and POSTs each one to the running intake server.

  - page*.md files: read as raw markdown, title derived from filename.
  - page*.json files: expected to have { title, url, markdown } fields,
    POSTed directly as-is.

.PARAMETER Dir
  Path to the walkthrough directory containing page files.

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

# Look for .json pages first, fall back to .md
$pages = Get-ChildItem -Path $Dir -Filter "page*.json" |
  Sort-Object { [int]($_.BaseName -replace 'page','') }

if ($pages.Count -gt 0) {
  $mode = "json"
} else {
  $pages = Get-ChildItem -Path $Dir -Filter "page*.md" |
    Sort-Object { [int]($_.BaseName -replace 'page','') }
  $mode = "md"
}

if ($pages.Count -eq 0) {
  Write-Error "No page*.json or page*.md files found in '$Dir'."
  exit 1
}

Write-Host "Found $($pages.Count) $mode page files in $Dir"
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
