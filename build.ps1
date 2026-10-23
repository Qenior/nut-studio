param([string]$OutputPath='dist\NUT-Studio.exe')
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
Push-Location $PSScriptRoot
try {
    if ([IO.Path]::IsPathRooted($OutputPath)) { $resolvedOutput = [IO.Path]::GetFullPath($OutputPath) }
    else { $resolvedOutput = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $OutputPath)) }
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($resolvedOutput))
    $version = (Get-Content -LiteralPath VERSION -Raw).Trim()
    if ((Get-Content -LiteralPath src\AssemblyInfo.cs -Raw) -notmatch ('AssemblyFileVersion\("' + [regex]::Escape($version + '.0') + '"\)')) { throw 'VERSION and AssemblyInfo.cs differ' }
    & $compiler /nologo /optimize+ /target:winexe /platform:x64 "/out:$resolvedOutput" /win32manifest:src\app.manifest /win32icon:src\app.ico /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /resource:ui\index.html,index.html /resource:ui\style.css,style.css /resource:ui\core.js,core.js /resource:ui\app.js,app.js /resource:ui\seed.json,seed.json /resource:ui\favicon.svg,favicon.svg /resource:docs\THIRD-PARTY-NOTICES.md,notices.md src\HidTransport.cs src\StripShortcut.cs src\Program.cs src\AssemblyInfo.cs
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    Write-Output "Built $resolvedOutput"
} finally { Pop-Location }
