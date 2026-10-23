param(
    [string]$NodeCommand = 'node',
    [string]$PythonCommand = 'python',
    [string]$ArtifactsDirectory = 'artifacts\tests'
)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
$previousTestTemp = $env:TEMP
try {
    & $NodeCommand --test tests/protocol.test.js tests/ui-state.test.js
    if ($LASTEXITCODE -ne 0) { throw 'JavaScript checks failed' }
    if ([IO.Path]::IsPathRooted($ArtifactsDirectory)) {
        $testDirectory = [IO.Path]::GetFullPath($ArtifactsDirectory)
    } else {
        $testDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $ArtifactsDirectory))
    }
    [void][IO.Directory]::CreateDirectory($testDirectory)
    $testExe = Join-Path $testDirectory 'NativeTests.exe'
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    & $compiler /nologo /target:exe /main:NativeTests "/out:$testExe" /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll src\HidTransport.cs src\StripShortcut.cs src\Program.cs tests\NativeTests.cs
    if ($LASTEXITCODE -ne 0) { throw 'Native check build failed' }
    $env:TEMP = $testDirectory
    & $testExe
    if ($LASTEXITCODE -ne 0) { throw 'Native checks failed' }
    $safetyExe = Join-Path $testDirectory 'NativeSafetyTests.exe'
    & $compiler /nologo /target:exe /main:NativeSafetyTests "/out:$safetyExe" /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll src\HidTransport.cs src\StripShortcut.cs src\Program.cs tests\NativeSafetyTests.cs
    if ($LASTEXITCODE -ne 0) { throw 'Native safety check build failed' }
    & $safetyExe
    if ($LASTEXITCODE -ne 0) { throw 'Native safety checks failed' }
    & $PythonCommand -B tests/release-package.test.py
    if ($LASTEXITCODE -ne 0) { throw 'Release package checks failed' }
} finally {
    $env:TEMP = $previousTestTemp
    Pop-Location
}
