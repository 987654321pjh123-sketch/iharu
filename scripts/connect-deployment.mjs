// Run once on your own computer: npm run deploy:connect
// Uses each vendor's normal login flow. No credentials are read or printed here.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = '987654321pjh123-sketch/iharu';
const team = '987654321pjh123-1875';
const projectId = 'prj_IcbkymE1hpnRZI7SaxyULQWMPMR7';
const orgId = 'team_GOcI5H9YPJhB6j5FuJbpi9Of';
const vercelVersion = '59.23.0';

function run(command, args, { capture = false, optional = false } = {}) {
  // Only constant npm executable names use the Windows shell shim. All arguments
  // below are fixed strings or validated GitHub profile fields, not shell input.
  const result = spawnSync(command, args, {
    cwd: root, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: process.platform === 'win32' && command === 'npx',
  });
  if ((result.error || result.status !== 0) && !optional) {
    throw new Error(`${command} 실행을 완료하지 못했습니다. 위 안내를 확인한 뒤 같은 명령을 다시 실행하세요.`);
  }
  return { ok: !result.error && result.status === 0, text: (result.stdout || '').trim() };
}
const vc = (...args) => run('npx', ['--yes', `vercel@${vercelVersion}`, ...args]);

function main() {
  if (!run('git', ['--version'], { capture: true, optional: true }).ok ||
      !run('gh', ['--version'], { capture: true, optional: true }).ok) {
    throw new Error('Git과 GitHub CLI(gh)가 필요합니다. 설치 후 터미널을 다시 열어 주세요.');
  }
  if (!run('gh', ['auth', 'status', '--hostname', 'github.com'], { capture:true, optional:true }).ok) {
    run('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--scopes', 'repo,workflow']);
  }
  const profile = JSON.parse(run('gh', ['api', 'user'], { capture:true }).text);
  if (profile.login !== repo.split('/')[0]) throw new Error('아이하루 소유 계정으로 GitHub CLI에 로그인해 주세요.');
  run('gh', ['auth', 'setup-git', '--hostname', 'github.com']);
  const remote = run('gh', ['repo', 'view', repo, '--json', 'nameWithOwner,isEmpty'], { capture:true, optional:true });
  if (remote.ok && !JSON.parse(remote.text).isEmpty && !existsSync(resolve(root,'.git'))) {
    throw new Error('원격 저장소에 기존 코드가 있습니다. 해당 저장소를 clone한 폴더에 이 패치를 적용한 뒤 실행하세요. 기존 코드를 덮어쓰지 않습니다.');
  }
  if (!existsSync(resolve(root,'.git'))) run('git', ['init', '-b', 'main']);
  const branch = run('git', ['branch', '--show-current'], { capture:true }).text;
  if (branch !== 'main') throw new Error('최초 연결은 main 브랜치에서 실행하세요. 다른 브랜치는 변경하지 않았습니다.');
  const existing = run('git', ['remote', 'get-url', 'origin'], { capture:true, optional:true });
  const allowed = [`https://github.com/${repo}.git`, `https://github.com/${repo}`, `git@github.com:${repo}.git`];
  if (existing.ok && !allowed.includes(existing.text)) throw new Error('origin이 다른 프로젝트를 가리킵니다. 아이하루 전용 폴더에서 실행하세요.');
  if (!run('git', ['config', 'user.name'], {capture:true,optional:true}).ok) run('git', ['config', 'user.name', profile.login]);
  if (!run('git', ['config', 'user.email'], {capture:true,optional:true}).ok) run('git', ['config', 'user.email', `${profile.id}+${profile.login}@users.noreply.github.com`]);
  run('git', ['add', '--', '.github', '.gitignore', '.nvmrc', '.env.example', '.vercelignore', 'README.md', 'api', 'db', 'package.json', 'package-lock.json', 'playwright.config.ts', 'scripts', 'server', 'shared', 'tests', 'tsconfig.json', 'vercel.json', 'vite.config.ts', 'vitest.config.ts', 'web']);
  const staged = run('git', ['diff', '--cached', '--name-only'], {capture:true}).text.split('\n').filter(Boolean);
  if (staged.some(p => /(^|\/)\.env(?!\.example$)|\.(pem|p12|pfx|key)$|^\.vercel\//i.test(p))) {
    throw new Error('업로드 대상에 비공개 설정 파일이 있습니다. 해당 파일을 staging에서 제외하고 재실행하세요.');
  }
  if (staged.length) run('git', ['commit', '-m', 'Configure Iharu Git deployment automation']);
  if (!remote.ok) {
    // A failure caused by permissions or network remains a vendor error; never
    // fall back to a public repository, another owner, or a force push.
    run('gh', ['repo', 'create', repo, '--private', '--source', '.', '--remote', 'origin', '--push']);
  } else {
    if (!existing.ok) run('git', ['remote', 'add', 'origin', `https://github.com/${repo}.git`]);
    run('git', ['push', '-u', 'origin', 'main']);
  }
  run('gh', ['repo', 'edit', repo, '--default-branch', 'main']);
  const signedIn = run('npx', ['--yes', `vercel@${vercelVersion}`, 'whoami'], {capture:true,optional:true});
  if (!signedIn.ok) vc('login');
  const linkedPath = resolve(root,'.vercel/project.json');
  if (existsSync(linkedPath)) {
    const linked = JSON.parse(readFileSync(linkedPath,'utf8'));
    if (linked.projectId !== projectId || linked.orgId !== orgId) throw new Error('다른 Vercel 프로젝트에 연결되어 있습니다. 연결 대상을 먼저 확인하세요.');
  }
  vc('link', '--yes', '--project', 'iharu', '--scope', team);
  const linked = JSON.parse(readFileSync(linkedPath,'utf8'));
  if (linked.projectId !== projectId || linked.orgId !== orgId) throw new Error('Vercel 연결 대상이 예상과 다릅니다. Git 연동을 중단합니다.');
  vc('git', 'connect', '--yes', '--scope', team);
  // The earlier initial push may have preceded the Git connection. Trigger a
  // deployment through that connection, rather than a separate CLI deployment.
  run('git', ['commit', '--allow-empty', '-m', 'Trigger initial Git deployment']);
  run('git', ['push', 'origin', 'main']);
  console.log('Git 연동과 첫 push를 완료했습니다. Vercel에서 빌드 결과가 Ready인지 확인하세요.');
  console.log('이후 main push → 운영, 다른 브랜치 push → Preview. DB 마이그레이션은 자동 실행하지 않습니다.');
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
