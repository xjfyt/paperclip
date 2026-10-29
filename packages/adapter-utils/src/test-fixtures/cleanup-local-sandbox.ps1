$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$ownedRoots = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
$candidates = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe', 'nohup.exe') })
foreach ($candidate in $candidates) {
  $command = ([string]$candidate.CommandLine).Replace('\', '/')
  if ($command -notmatch 'paperclip-(process-session-remote(?:-stream)?|bridge-server)\.mjs') { continue }
  $owned = $false
  foreach ($root in $ownedRoots) {
    $prefix = ([string]$root).Replace('\', '/').TrimEnd('/') + '/'
    if ($command.IndexOf($prefix, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $candidate.CreationDate.ToUniversalTime() -ge [IO.Directory]::GetCreationTimeUtc($root)) {
      $owned = $true
      break
    }
  }
  if (-not $owned) { continue }
  $process = $null
  try {
    $process = [Diagnostics.Process]::GetProcessById($candidate.ProcessId)
    # Open and retain the handle before comparing identity. Kill/WaitForExit
    # operate on this process object, never on an unverified later PID lookup.
    $handle = $process.Handle
    if ([Math]::Abs($process.StartTime.ToUniversalTime().Ticks - $candidate.CreationDate.ToUniversalTime().Ticks) -ge [TimeSpan]::TicksPerMillisecond) { continue }
    $process.Kill()
    if (-not $process.WaitForExit(5000)) { throw 'An owned sandbox fixture process did not exit' }
  } catch [ArgumentException] {
    # It already exited between the process-table snapshot and handle open.
  } finally {
    if ($null -ne $process) { $process.Dispose() }
  }
}
