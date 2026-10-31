<#
.SYNOPSIS
    Runs Pester test files in parallel, one PowerShell process per file, and prints one summary.
.DESCRIPTION
    A suite is usually dominated by a few files; one process per file lets them run side by side. Files run
    slowest first, using the durations of the previous run (kept in -TimingsFile), so the slowest file starts
    at once and sets the wall time. A process per file also isolates modules that cannot share a process
    (PSRule and powershell-yaml load different YamlDotNet versions).

    Output: one line per file, the failures (first lines of each message), and a last line
    'Passed <n> Failed <n> Skipped <n> in <s>s (<n> files)'.
    Exit code: 0 when every file passed, 1 when a test failed or a file could not run.

    From the test-speed skill; the justfile recipes test, test-changed and test-serial call it.
.PARAMETER Path
    Test files or folders (default: Tests, else tests, else the repository). Folders are searched for *.Tests.ps1.
.PARAMETER Serial
    Run all files in this process, one after another (the plain Invoke-Pester run, for debugging).
.PARAMETER ThrottleLimit
    Processes at the same time (default: half the logical processors, at least 2).
.PARAMETER TimingsFile
    JSON file with the duration per test file from the previous run (default: .devenv/state/test-timings.json
    when .devenv exists, else .cache/test-timings.json; both are usually git-ignored).
.EXAMPLE
    pwsh -File scripts/Invoke-PesterParallel.ps1
.EXAMPLE
    pwsh -File scripts/Invoke-PesterParallel.ps1 Tests/Bicep Tests/Modules/Foo
#>
[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(ValueFromRemainingArguments)] [string[]] $Path = @(),
    [switch] $Serial,
    [ValidateRange(1, 256)] [int] $ThrottleLimit = [Math]::Max(2, [int][Math]::Floor([Environment]::ProcessorCount / 2)),
    [string] $TimingsFile = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (& git -C $PSScriptRoot rev-parse --show-toplevel)
if ($LASTEXITCODE -ne 0 -or -not $repositoryRoot) { throw "$PSScriptRoot is not in a git repository." }
if (-not $TimingsFile) {
    $state = if (Test-Path -LiteralPath (Join-Path $repositoryRoot '.devenv')) { '.devenv/state' } else { '.cache' }
    $TimingsFile = Join-Path $repositoryRoot "$state/test-timings.json"
}

$Path = @($Path | Where-Object { $_ })
if (-not $Path) {
    $Path = @(foreach ($candidate in 'Tests', 'tests') {
            if (Test-Path -LiteralPath (Join-Path $repositoryRoot $candidate)) { Join-Path $repositoryRoot $candidate; break }
        })
    if (-not $Path) { $Path = @($repositoryRoot) }
}

$files = @(@(
        foreach ($item in $Path) {
            $full = if ([IO.Path]::IsPathRooted($item)) { $item } else { Join-Path $repositoryRoot $item }
            if (-not (Test-Path -LiteralPath $full)) { continue }
            $resolved = (Resolve-Path -LiteralPath $full).Path
            if (Test-Path -LiteralPath $resolved -PathType Leaf) { $resolved }
            else { Get-ChildItem -LiteralPath $resolved -Recurse -File -Filter '*.Tests.ps1' | ForEach-Object FullName }
        }) | Sort-Object -Unique)
if (-not $files) {
    Write-Information "No *.Tests.ps1 files under: $($Path -join ', ')" -InformationAction Continue
    exit 0
}

if ($Serial) {
    $configuration = New-PesterConfiguration
    $configuration.Run.Path = $files
    $configuration.Run.Exit = $true
    Invoke-Pester -Configuration $configuration
    exit $LASTEXITCODE
}

$timings = @{}
if (Test-Path -LiteralPath $TimingsFile) {
    (Get-Content -LiteralPath $TimingsFile -Raw | ConvertFrom-Json).PSObject.Properties |
        ForEach-Object { $timings[$_.Name] = [double] $_.Value }
}
$ordered = $files | Sort-Object -Descending -Property { $timings[[IO.Path]::GetRelativePath($repositoryRoot, $_)] ?? 0 }

# One process per file; the child writes a small JSON summary that the parent collects.
$child = @'
param([string] $File, [string] $Out)
$ErrorActionPreference = 'Stop'
$c = New-PesterConfiguration
$c.Run.Path = $File; $c.Run.PassThru = $true; $c.Output.Verbosity = 'None'
$r = Invoke-Pester -Configuration $c
$failed = @($r.Failed | ForEach-Object {
    [ordered]@{ name = $_.ExpandedPath; message = (@($_.ErrorRecord | ForEach-Object { "$_" }) -join "`n") } })
$failed += @($r.FailedBlocks | ForEach-Object {
    [ordered]@{ name = "$($_.ExpandedPath) (block)"; message = (@($_.ErrorRecord | ForEach-Object { "$_" }) -join "`n") } })
$failed += @($r.FailedContainers | ForEach-Object {
    [ordered]@{ name = "$($_.Item) (container)"; message = (@($_.ErrorRecord | ForEach-Object { "$_" }) -join "`n") } })
[ordered]@{ passed = $r.PassedCount; failed = $r.FailedCount + $r.FailedBlocksCount + $r.FailedContainersCount
    skipped = $r.SkippedCount; failures = $failed } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $Out
'@
$work = Join-Path ([IO.Path]::GetTempPath()) "pester-parallel-$PID"
New-Item -ItemType Directory -Path $work -Force | Out-Null
$childScript = Join-Path $work 'run-file.ps1'
Set-Content -LiteralPath $childScript -Value $child

$started = [Diagnostics.Stopwatch]::StartNew()
Write-Information "Running $($files.Count) test files, $ThrottleLimit at a time" -InformationAction Continue
$results = @($ordered | ForEach-Object -ThrottleLimit $ThrottleLimit -Parallel {
        $file = $_
        $relative = [IO.Path]::GetRelativePath($using:repositoryRoot, $file)
        $out = Join-Path $using:work ([guid]::NewGuid().ToString() + '.json')
        $watch = [Diagnostics.Stopwatch]::StartNew()
        $log = & pwsh -NoLogo -NoProfile -NonInteractive -File $using:childScript -File $file -Out $out 2>&1
        $watch.Stop()
        $summary = if (Test-Path -LiteralPath $out) { Get-Content -LiteralPath $out -Raw | ConvertFrom-Json } else {
            [pscustomobject]@{ passed = 0; failed = 1; skipped = 0
                failures = @([pscustomobject]@{ name = "$relative (did not run)"; message = ($log -join "`n") }) }
        }
        $line = '{0,7:N1}s  {1,4} passed  {2,3} failed  {3,3} skipped  {4}' -f $watch.Elapsed.TotalSeconds,
        $summary.passed, $summary.failed, $summary.skipped, $relative
        [pscustomobject]@{ File = $relative; Seconds = $watch.Elapsed.TotalSeconds; Summary = $summary; Line = $line }
    } | ForEach-Object {
        # Printed here, as each file finishes: the information stream of -Parallel runspaces does not reach the console.
        Write-Information $_.Line -InformationAction Continue
        $_
    })
$started.Stop()
Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue

foreach ($result in $results) { $timings[$result.File] = [Math]::Round($result.Seconds, 1) }
New-Item -ItemType Directory -Path (Split-Path -Parent $TimingsFile) -Force | Out-Null
$timings | ConvertTo-Json | Set-Content -LiteralPath $TimingsFile

$passed = ($results.Summary | Measure-Object -Property passed -Sum).Sum
$failed = ($results.Summary | Measure-Object -Property failed -Sum).Sum
$skipped = ($results.Summary | Measure-Object -Property skipped -Sum).Sum
foreach ($result in $results | Where-Object { $_.Summary.failed -gt 0 }) {
    foreach ($failure in $result.Summary.failures) {
        Write-Information '' -InformationAction Continue
        Write-Information "[-] $($result.File) :: $($failure.name)" -InformationAction Continue
        $message = ($failure.message -split "`n" | Select-Object -First 8 | ForEach-Object { "    $_" }) -join "`n"
        Write-Information $message -InformationAction Continue
    }
}
Write-Information '' -InformationAction Continue
Write-Information ('Passed {0} Failed {1} Skipped {2} in {3:N1}s ({4} files)' -f $passed, $failed, $skipped,
    $started.Elapsed.TotalSeconds, $results.Count) -InformationAction Continue
exit [int] ($failed -gt 0)
