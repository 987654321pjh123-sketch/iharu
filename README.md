# 아이하루

P01 개발 기반·공통 화면. 제품 기준 6.1 / 단계별 구축 계획 1.0.

## 실행

Node.js 24와 npm을 사용합니다.

```sh
npm ci
npm run dev
```

브라우저: `http://localhost:5173/today`, 아이 화면: `/child`.
Vite가 `/api` 요청을 로컬 Hono(8787)로 전달합니다.
별도 외부 계정 없이 **가상 가족 화면**을 확인할 수 있습니다.

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

빌드 결과와 같은 도메인의 API를 함께 확인하려면 `npm run build` 후 `npm start`로 실행합니다(4173). `vite preview`만 실행하면 API 서버가 없으므로 이 프로젝트의 전체 확인에 사용하지 않습니다.

## 구현된 범위

- 보호자 홈, 아이 홈, 월간 일정·학원비 예시 화면과 공통 내비게이션.
- 아이별 필터, 월·날짜 이동, 큰 글씨 설정, 모바일 메뉴, 키보드 확인창.
- Hono API, Zod 요청·응답 계약, 가상 데이터, 오류·재시도, 인증 전 업무 API 차단.
- Vercel API/SPA 라우팅, 환경 분리, PostgreSQL 연결 어댑터·마이그레이션 실행기, CI 검사.
- 위치·대화·기록 등 후속 메뉴는 준비 상태입니다. 버튼이 성공한 것처럼 기록·전송을 흉내 내지 않습니다.

로컬 기본은 데모입니다. `APP_ENV=production` 또는 `VERCEL_ENV=production`에서는 데모 API를 항상 막습니다. 현재 프로덕션 화면은 준비 화면입니다. 보호자/아이 전환은 미리보기이며 인증이나 역할 변경이 아닙니다.

## 외부 연결

P01의 실제 DB는 아직 연결되지 않았습니다. `.env.example`을 `.env.local`로 복사하고, 자격 값은 로컬 비공개 파일 또는 Vercel 환경변수에만 입력합니다. 채팅이나 저장소에 비밀번호를 넣지 않습니다. 프런트엔드에 DB 키를 전달하지 않습니다.

- `APP_DATABASE_URL`: 업무 전용 계정. 관리자·테이블 소유자·BYPASSRLS 금지. Supabase transaction pool 연결은 `prepare:false` 적용.
- `AUTH_DATABASE_URL`, `WORKER_DATABASE_URL`: P02~P03 이후 각 용도로 분리 연결.
- `MIGRATION_DATABASE_URL`: 스키마 관리용. 요청 처리 서버에서 읽지 않음.
- `MIGRATION_TARGET`: `APP_ENV`와 동일하게 지정한 경우에만 `npm run db:migrate`가 실행됩니다. 실행 환경별 DB 주소가 실제로 올바른 프로젝트인지 별도로 확인합니다.
- `npm run db:check`: 연결과 업무 계정의 기본 위험 권한 검사. 자녀별 RLS 검증은 P03 범위입니다.

첫 SQL은 비공개 `app` 스키마 경계만 만듭니다. 업무 테이블·인증 스키마·자녀 동의·RLS 정책이 준비되기 전 실제 아동 정보를 넣지 않습니다. 이미 적용된 SQL 파일은 변경하지 않고 다음 번호를 추가합니다. DB 오류에 접속 문자열을 출력하지 않습니다.

## Vercel

루트 디렉터리는 이 `package.json`이 있는 폴더입니다. 프레임워크 Vite, Node 24, 설치 `npm ci`, 배포 빌드 `npm run build:deploy`, 출력 `dist`, 함수 리전 설정 `icn1`입니다. `/api`는 Hono 함수로, 나머지 화면 주소는 SPA로 연결합니다.

`vercel.json`의 `DEMO_MODE=true`는 P01 Preview 확인용입니다. 프로덕션은 서버 코드에서 별도로 차단합니다. 비밀값은 이 파일에 넣지 않습니다. Preview와 Production의 DB·인증 비밀값은 서로 다른 것으로 설정합니다.

현재 Vercel `iharu` 프로젝트에 배포했습니다. [P01 미리보기](https://iharu-qmzq8f97k-987654321pjh123-1875.vercel.app/today)는 Vercel 접근 권한이 필요할 수 있습니다. 기본 주소 `iharu.vercel.app`은 준비 화면만 제공합니다. 프로젝트 생성 시 최초 배포가 자동으로 Production에 배정되어, 수정본으로 준비 화면을 배포했습니다. 실제 서비스 데이터나 로그인은 연결하지 않았습니다.

소스 저장소는 [987654321pjh123-sketch/iharu](https://github.com/987654321pjh123-sketch/iharu)입니다. 2026-09-18 생성 시 공개(Public) 상태로 확인했습니다. 소스와 자동 검사 설정이 저장소에 반영되어 있습니다. Vercel Git 연결 후 새 커밋부터 자동 배포를 실행하며, 완료 여부는 배포의 Git 커밋 SHA와 `READY` 상태로 확인합니다. 기존 배포의 `READY`만으로 새 커밋이 반영되었다고 판단하지 않습니다. `vercel.json`에는 `icn1`을 지정했으나 기존 배포 메타데이터는 `iad1`을 반환했습니다. Supabase 연결 전 함수의 실제 리전과 DB 근접성 설정을 다시 확인해야 합니다.

## 자동 배포

배포 주체는 Vercel Git 연동 한 곳입니다. 별도 배포 토큰·배포용 GitHub Actions를 중복 구성하지 않습니다. 계정 연결 후 동작은 다음과 같습니다.

| 변경 | 자동 동작 |
| --- | --- |
| `main`에 push/merge | API 테스트 → 타입 검사 → 빌드 성공 시 운영 배포 |
| 다른 브랜치에 push | 같은 검사 후 Preview 배포 |
| Pull Request 또는 `main` push | GitHub Actions에서 위 검사와 Chromium 브라우저 테스트 |
| 필수 배포 검사 실패 | 새 배포 중단, 기존 정상 배포 유지 |
| SQL 파일 변경 | 코드만 배포. DB 마이그레이션 자동 실행 없음 |

브라우저 테스트는 GitHub의 추가 검사이며 Vercel 배포를 기다리게 하는 필수 조건으로 연결되어 있지는 않습니다. API 테스트·타입 검사·빌드는 Vercel 자체 빌드 명령에 포함되어 있어 실패하면 배포되지 않습니다. CI의 중복 실행은 취소하며 별도 단계별 보고서나 수동 승인은 요구하지 않습니다.

최초 연결을 이 대화에서 완료하지 못한 경우에는 PC의 이 프로젝트 폴더에서 다음 명령을 한 번 실행할 수 있습니다. Git과 GitHub CLI가 설치되어 있어야 합니다. GitHub·Vercel 로그인은 각 서비스의 보안 로그인 화면에서 처리하며 비밀번호를 채팅에 입력하지 않습니다.

```sh
npm run deploy:connect
```

이 명령은 `987654321pjh123-sketch/iharu` 비공개 저장소 생성·코드 push·기존 Vercel `iharu` 연결·Git 연동 후 첫 push를 수행합니다. 연결된 계정에 저장소 생성과 Vercel Git 앱 접근 권한이 있어야 하며 권한이 없으면 중단됩니다. 기존 원격 저장소의 내용이나 다른 프로젝트를 강제로 덮어쓰지 않습니다. Vercel CLI는 `59.23.0`으로 고정했습니다. 최초 연결 스크립트의 외부 계정 작업은 이 작업 환경에서 실행 검증하지 못했습니다.

연결 후에는 변경 코드를 commit하고 `git push`하면 됩니다. 운영 주소는 `https://iharu.vercel.app`, Preview 주소는 Vercel의 해당 배포에서 확인합니다. 기존 P01 정책대로 운영은 준비 화면, Preview는 가상 데이터 화면입니다. 운영 배포 활성화가 P02 이후 업무 기능을 자동으로 구현하거나 DB를 연결하지는 않습니다.

자동화 변경 파일: `package.json`(배포 검사 명령), `vercel.json`(Git 자동 배포), `.github/workflows/check.yml`(CI·중복 취소), `.vercelignore`(비공개·임시 파일 제외), `scripts/connect-deployment.mjs`(최초 연결), `README.md`(실행 안내). 삭제 파일은 없습니다.

공식 동작 참고: [Vercel Git 연결](https://vercel.com/docs/cli/git), [브랜치 자동 배포 설정](https://vercel.com/docs/project-configuration/git-configuration), [GitHub 저장소 생성](https://cli.github.com/manual/gh_repo_create).

구현 경계: `web/src` / `server/auth` / `server/policy` / `server/domain` / `server/adapters` / `shared` / `db/migrations`.
이후 P02에서 실제 로그인과 세션을 붙이고, P03에서 가족·자녀 권한을 연결합니다. 현 단계의 `resolvePrincipal`은 항상 접근을 거절합니다.

배포 형식 참고: [Vercel Node 함수](https://vercel.com/docs/functions/runtimes/node-js), [Vite SPA 직접 주소](https://vercel.com/docs/frameworks/frontend/vite).
