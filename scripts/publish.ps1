$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Repository = 'tycofficial/tiaoyitiao'
$ExpectedLogin = 'tycofficial'

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program command failed (exit $LASTEXITCODE)." }
}

Push-Location -LiteralPath $ProjectRoot
try {
    foreach ($Command in @('git', 'gh', 'node')) {
        if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) { throw "Required command not found: $Command. Install it from its official source first." }
    }
    Invoke-Checked gh @('auth', 'status', '--hostname', 'github.com')
    $Profile = (& gh api user | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read authenticated GitHub profile.' }
    if ($Profile.login -ne $ExpectedLogin) { throw "Expected GitHub account $ExpectedLogin; current account is $($Profile.login)." }
    Invoke-Checked node @('scripts/check.cjs')
    $Tests = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'tests') -Filter '*.test.cjs' -File | ForEach-Object { $_.FullName })
    if ($Tests.Count -eq 0) { throw 'No regression tests found.' }
    Invoke-Checked node (@('--test') + $Tests)

    $RepoOutput = & gh api "repos/$Repository" 2>&1
    $RepoExists = $LASTEXITCODE -eq 0
    if (-not $RepoExists -and ($RepoOutput -join "`n") -notmatch '404') { throw 'Cannot verify repository. No changes made.' }
    if ($RepoExists) {
        $RemoteRepo = ($RepoOutput -join "`n") | ConvertFrom-Json
        if ($RemoteRepo.private) { throw 'The existing repository is private. This script will not change its visibility.' }
    }

    $HasGit = Test-Path -LiteralPath (Join-Path $ProjectRoot '.git')
    if (-not $HasGit) { Invoke-Checked git @('init', '-b', 'main') }
    $Branch = (& git branch --show-current).Trim()
    if ($Branch -ne 'main') { throw 'Run this script from the main branch.' }
    $Remote = & git remote get-url origin 2>$null
    if ($LASTEXITCODE -eq 0) {
        if ($Remote.Trim() -notin @("https://github.com/$Repository.git", "https://github.com/$Repository", "git@github.com:$Repository.git")) { throw 'The local origin points to a different repository.' }
    } else {
        Invoke-Checked git @('remote', 'add', 'origin', "https://github.com/$Repository.git")
    }
    if ($RepoExists) {
        $RemoteHead = & git ls-remote origin refs/heads/main
        if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect remote history.' }
        if ($RemoteHead) {
            $RemoteSha = ($RemoteHead -split '\s+')[0]
            $LocalSha = & git rev-parse --verify HEAD 2>$null
            if ($LASTEXITCODE -ne 0 -or $LocalSha.Trim() -ne $RemoteSha) { throw 'Local HEAD differs from remote main. Clone or synchronize normally before publishing; no force push is performed.' }
        } else {
            $OtherRemoteHeads = & git ls-remote --heads origin
            if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect remote branches.' }
            if ($OtherRemoteHeads) { throw 'The existing repository uses another branch. Review it manually before publishing.' }
        }
    }

    $LocalName = & git config --local user.name
    if (-not $LocalName) { Invoke-Checked git @('config', '--local', 'user.name', [string]$Profile.login) }
    $LocalEmail = & git config --local user.email
    if (-not $LocalEmail) { Invoke-Checked git @('config', '--local', 'user.email', "$($Profile.id)+$($Profile.login)@users.noreply.github.com") }
    $PublishFiles = @('index.html', 'tiaoyitiao.html', 'README.md', 'THIRD_PARTY_NOTICES.md', 'package.json', '.gitignore', '.nojekyll', '.github/workflows/check.yml')
    $PublishFiles += @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'scripts') -File | Where-Object { $_.Extension -in @('.cjs', '.ps1') } | ForEach-Object { 'scripts/' + $_.Name })
    $PublishFiles += @($Tests | ForEach-Object { 'tests/' + (Split-Path -Leaf $_) })
    Invoke-Checked git (@('add', '--') + $PublishFiles)
    $StagedFiles = @(& git diff --cached --name-only)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect staged file names.' }
    foreach ($StagedFile in $StagedFiles) {
        if ($StagedFile -notin $PublishFiles) { throw "Unexpected staged file: $StagedFile. Review the index before publishing." }
    }
    & git diff --cached --quiet
    if ($LASTEXITCODE -eq 1) { Invoke-Checked git @('commit', '-m', 'Fix jump gameplay and audio; prepare GitHub Pages') }
    elseif ($LASTEXITCODE -ne 0) { throw 'Cannot inspect staged changes.' }

    if (-not $RepoExists) { Invoke-Checked gh @('repo', 'create', $Repository, '--public', '--description', '跳一跳：单文件离线复刻与浏览器兼容性修复') }
    Invoke-Checked gh @('auth', 'setup-git', '--hostname', 'github.com')
    Invoke-Checked git @('push', '-u', 'origin', 'main')
    $PagesOutput = & gh api "repos/$Repository/pages" 2>&1
    $PagesExists = $LASTEXITCODE -eq 0
    if (-not $PagesExists -and ($PagesOutput -join "`n") -notmatch '404') { throw 'Pushed successfully, but could not inspect Pages configuration.' }
    $Method = if ($PagesExists) { 'PUT' } else { 'POST' }
    '{"build_type":"legacy","source":{"branch":"main","path":"/"}}' | & gh api --method $Method "repos/$Repository/pages" --input -
    if ($LASTEXITCODE -ne 0) { throw 'Pushed successfully, but Pages configuration failed. Set main / (root) in Settings > Pages.' }
    Write-Host "Repository: https://github.com/$Repository"
    Write-Host 'Pages configured. Wait for GitHub deployment to finish: https://tycofficial.github.io/tiaoyitiao/'
} finally {
    Pop-Location
}
