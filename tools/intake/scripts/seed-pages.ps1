<#
.SYNOPSIS
  POST local markdown pages to the intake server.

.DESCRIPTION
  Finds all pageN.md files in the given walkthrough directory and POSTs
  each one to the running intake server.

.PARAMETER Dir
  Path to the walkthrough directory containing page*.md files.

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

$pages = Get-ChildItem -Path $Dir -Filter "page*.md" |
  Sort-Object { [int]($_.BaseName -replace 'page','') }

if ($pages.Count -eq 0) {
  Write-Error "No page*.md files found in '$Dir'."
  exit 1
}

$count = 0
foreach ($page in $pages) {
  $num = $page.BaseName -replace 'page',''
  $md = Get-Content $page.FullName -Raw
  $body = @{
    title = "Page $num"
    url   = "file://$($page.Name)"
    markdown = $md
  } | ConvertTo-Json

  Invoke-RestMethod -Method Post -Uri "$Server/api/intake" `
    -ContentType 'application/json' -Body $body | Out-Null

  $count++
  Write-Host "  ✓ $($page.Name) (page $num)"
}

Write-Host ""
Write-Host "Seeded $count pages to $Server"
Write-Host "Verify: (Invoke-RestMethod $Server/api/pages).Count"
