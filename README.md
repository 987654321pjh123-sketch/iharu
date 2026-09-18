# 아이하루

제품 기준 6.1 · P01 공통 화면 + P02 로그인·계정 + P03 가족·아이·기기 연결 구현.

```sh
npm ci
npm run dev
```

Node.js 24 / React·Vite·TypeScript / 동일 도메인 Hono / Supabase PostgreSQL / Better Auth **1.7.5**를 사용합니다. 로그인 화면은 `http://localhost:5173/login`, P01 가상 가족 화면은 `/today`, 아이 화면은 `/child`입니다. 운영에서는 데모 API를 차단하고 로그인 화면으로 연결합니다.

## P02 구현과 현재 연결 상태

- 이메일 가입·인증·로그인·비밀번호 복구, Google·카카오·네이버 OAuth 경로, 휴대폰 OTP 로그인.
- 명시적 로그인 수단 연결·해제, 이메일 추가 시 현재 계정의 최근 인증 + 새 이메일 증명, 마지막 로그인 수단 보호.
- 기기 목록, 개별/전체 로그아웃, 비밀번호 재설정 후 전체 세션 폐기.
- SMS 세션은 LOW. 본인 계정 최소 상태·추가 확인·복구 요청·로그아웃만 허용합니다. 프로필·로그인 방법·기기·가족 정보는 반환하지 않습니다.
- 이메일/기존 소셜 로그인으로 확인한 HIGH 세션도 `access_ready`가 없으면 업무 API를 사용할 수 없습니다. P03 가족·동의·권한 경로를 구현했으며 본인·관계 확인 공급자 연결은 남아 있습니다.
- 계정 복구 요청은 DB에 접수합니다. 운영자 검토·본인확인 공급자 처리는 후속 단계입니다. 자동으로 계정을 병합하거나 접근 권한을 올리지 않습니다.

**외부 DB·메일·문자·소셜 앱의 실제 연결 및 실계정 왕복 검증은 남아 있습니다.** API 키가 없는 방법은 화면에 준비 중으로 표시합니다. 내부 테스트 통과를 외부 공급자 개통이나 P02 전체 완료로 간주하지 않습니다. 다섯 로그인 방법은 정식 출시 범위에 유지합니다.

## P03 가족과 아이 연결

- `/family`: 가족 생성, 일회용 초대, 참여 승인, 운영권 이전, 아이별 공유 권한·동의·연결 기기 관리. OWNER에게 아이 정보가 자동 공개되지 않습니다.
- `daily / chat / location / tuition_read / tuition_write`를 아이·보호자별로 적용합니다. 비용 쓰기는 읽기를 전제로 하며 아이 기기는 비용 API를 사용할 수 없습니다. chat 신규 승인 시 방의 다음 순번부터 읽도록 기록합니다.
- 아이 등록은 정보 없는 초안 → 검증된 관계 결과 → 필수 일반/선택 위치 동의 → 일회용 proof → 아이·동의·grant·대화방의 한 트랜잭션 생성 순서입니다. 확인된 대상·생년월일·가족·신청자를 다른 값으로 바꿀 수 없습니다.
- `/device/connect`: 보호자가 로그인하지 않은 아이 기기에서 큰 6자리 번호를 받고 보호자가 승인합니다. 임시 HttpOnly 증명이 있는 시작 기기만 교환할 수 있습니다. 같은 교환 키는 2분 동안 같은 쿠키 결과를 재전달하며 기기는 한 건만 생성합니다. 별도의 가족 로그인·비용 권한은 생기지 않습니다.
- 기기 쿠키와 임시 증명은 HTTPS에서 `__Host-`·Secure·HttpOnly·SameSite=Strict입니다. 토큰·초대·코드는 해시로 저장하고, 재전달용 쿠키만 AES-GCM으로 2분간 사용할 수 있게 암호화합니다. URL/localStorage에 기기 토큰을 넣지 않습니다. 초대 링크는 서버에 전송되지 않는 fragment를 사용하고 초대 화면에서 즉시 지웁니다.
- 동의·grant·기기 철회는 다음 요청부터 차단됩니다. 위치 동의 철회는 일반 기능을 유지합니다. 일반 동의 철회는 아이·기기를 차단하고 삭제 접수와 독립 원장 Outbox를 함께 저장합니다. 실제 삭제 작업자·외부 독립 원장 전송은 P11/P12 연결 대상입니다.
- 한 가족의 활성 성인 5명·아이 5명, 아이당 활성 기기 2대를 서버 잠금 안에서 제한합니다. 버전이 다른 승인·수정·운영권 이전은 409로 거절합니다. 초대·등록·기기 연결에는 서버 만료와 입력·요청 제한을 적용합니다.

**현재 운영 연결 제한:** 운영 DB 및 인증 공급자가 미연결 상태이며 실제 본인확인·법정대리 관계 확인 수단도 미정입니다. `access_ready`를 화면에서 올리는 경로, 가짜 관계 인증 콜백은 제공하지 않습니다. `/api/v1/setup`은 실제 아동 등록 준비 상태를 false로 반환합니다. 관계 확인 어댑터·정책·삭제 운영 경로를 완성하기 전 실제 아이 등록을 공개하지 않습니다. 테스트의 `__test__` 엔드포인트는 별도 로컬 서버에만 존재하며 배포 번들에서 참조하지 않습니다.

### DB 권한과 운영 연결

`APP_DATABASE_URL`은 `app_runtime` 권한만 가진 별도 로그인 역할을 사용합니다. `AUTH_DATABASE_URL`, `WORKER_DATABASE_URL`, `MIGRATION_DATABASE_URL`과 공유하지 않습니다. 업무 런타임은 시작 시 소유자·SUPERUSER·BYPASSRLS·정책 함수 소유 역할의 상속을 검사합니다.

Supabase DB TLS 연결은 공식 CLI의 공개 Production CA(2021·2025)를 서버 코드에 포함해 인증서 체인과 호스트명을 검증합니다. 인증서 원본 commit은 `server/adapters/supabase-ca.ts`에 기록되어 있습니다. 별도 비밀 환경변수나 런타임 다운로드는 필요하지 않습니다. `rejectUnauthorized:false`, `sslmode=no-verify`, `NODE_TLS_REJECT_UNAUTHORIZED=0`으로 우회하지 않습니다. CA 갱신 시 공식 원본·유효기간을 확인하고 테스트 후 배포합니다.

운영 연결 확인: `/api/account/providers`와 `/api/v1/child-session` 조회 후 Vercel 비공개 로그의 `AUTH_DATABASE_CHECK_OK`, `FAMILY_DATABASE_CHECK_OK`를 확인합니다. 인증 없는 아이 세션 조회의 `DEVICE_REQUIRED`(401)는 정상입니다. 로그인 공급자 설정은 DB 연결과 별개이며, 모든 공급자가 비활성이라는 응답만으로 DB 연결 성공을 판단하지 않습니다. 실패 시 `*_CHECK_FAILED` 또는 `FAMILY_RUNTIME_UNAVAILABLE`의 `reason`만 확인하며 비밀번호·접속 URL은 로그에 남기지 않습니다.

- `0004`: 가족·membership·아이·consent·grant·방·기기에 강제 RLS, 복합 가족 FK. 앱 런타임은 제한된 SELECT와 명령 함수 실행만 가능하며 직접 정책 테이블 수정은 불가합니다.
- `0005`: 현재 인증 DB 상태를 재확인하는 명령 함수. `iharu_policy`는 로그인 불가·BYPASSRLS 없는 전용 함수 소유자이며 모든 함수는 고정 search_path를 사용합니다. 이 역할을 런타임 역할에 상속하지 않습니다.
- `0006`: 별도 검증 계정용 관계 결과 적용 함수, 범위별 철회 원장 이벤트, 만료 비밀 정리 함수. `verification_runtime`/`worker_runtime` 역할이 사전에 존재할 때만 필요한 함수 실행 권한을 부여합니다. 역할을 나중에 만들면 관리자가 해당 최소 권한을 별도로 부여해야 합니다.
- 검증 함수는 신뢰할 수 있는 서버 콜백 또는 승인된 심사 경로에서만 사용합니다. 공급자 서명·일회성 거래 ID와 대상 확인 어댑터는 아직 연결하지 않았습니다. SMS나 이메일 인증만으로 호출하지 않습니다.
- `expire_family_secrets()`는 만료된 재전달 비밀, 초안·proof·초대를 정리합니다. P11/P12에서 worker 계정으로 매분 연결해야 합니다. 현재 코드만으로 주기 실행되지는 않습니다. 2분 경과한 비밀은 정리 전에도 재전달이 거절됩니다.
- 독립 원장의 실제 외부 저장소 연결과 재적용 시험 전에는 복원 데이터를 공개하지 않습니다. Outbox 행 생성은 외부 기록 성공을 의미하지 않습니다.

## 인증 연결

`.env.example`을 `.env.local`로 복사합니다. 비밀값은 이 파일 또는 Vercel 환경변수에 입력하며 저장소·채팅·`VITE_` 변수에 넣지 않습니다. Preview에는 운영 DB와 키를 복사하지 않습니다.

| 설정 | 용도 |
| --- | --- |
| `AUTH_DATABASE_URL` | Supabase PostgreSQL의 별도 `auth_runtime` 비소유자 계정. 인증 스키마만 접근 |
| `APP_ORIGIN` | 정확한 웹앱 origin. 로컬 `http://localhost:5173`, 운영 `https://iharu.vercel.app`. 끝 `/` 제외 |
| `BETTER_AUTH_SECRET` | 32바이트 이상 난수로 생성한 서버 전용 비밀값 |
| `RESEND_API_KEY`, `MAIL_FROM` | 인증·복구 메일. 발송 도메인 검증과 도달 시험 필요 |
| `GOOGLE_CLIENT_ID/SECRET` | Google OAuth |
| `KAKAO_CLIENT_ID/SECRET` | 카카오 REST 앱. 닉네임·이메일 동의 항목 설정 |
| `NAVER_CLIENT_ID/SECRET` | 네이버 OAuth와 서비스 검수 |
| `SOLAPI_API_KEY/SECRET`, `SMS_FROM`, `SMS_DAILY_BUDGET` | 승인된 발신번호와 일일 발송 시도 상한. 값이 없으면 SMS 비활성화 |

OAuth 리디렉션 URI는 각 환경의 `APP_ORIGIN/api/auth/callback/google`, `/kakao`, `/naver`입니다. 메일이 없는 소셜 프로필은 내부 식별용 주소만 발급하며 연락처로 인정하지 않습니다. `/account/email`에서 최근 인증과 실제 이메일 확인을 거쳐 이메일 로그인 수단을 추가합니다.

Resend·SOLAPI는 교체 가능한 발송 어댑터입니다. 이번 작업에서 계정 생성·유료 계약·실제 발송을 실행하지 않았습니다. SOLAPI 호출은 요청당 한 번만 시도하며 응답 불명 시 자동 재발송하지 않습니다. 문자 수신 확인을 성인·보호자 관계 확인으로 사용하지 않습니다.

## DB 적용

마이그레이션 관리자와 `auth_runtime`, `app_runtime`, 작업 계정은 분리합니다. DB 관리 화면에서 `auth_runtime` 로그인 역할을 먼저 만들고 별도 비밀번호를 설정한 뒤, 관리자 연결로 실행합니다.

```sh
# .env.local의 APP_ENV와 MIGRATION_TARGET을 같은 대상 환경으로 지정합니다.
# MIGRATION_DATABASE_URL은 해당 환경의 스키마 관리자 연결입니다.
npm run db:migrate
```

- `0001`: 기존 비공개 app 경계. 이미 적용된 SQL은 수정하지 않았습니다.
- `0002`: Better Auth 1.7.5 `getMigrations`로 생성한 인증 테이블. 수작업 변경 금지.
- `0003`: 회원 상태, 세션 수준·최종 활동, OTP/발송 제한, 이메일 연결, 복구 접수. `auth_runtime` 역할이 있으면 인증 스키마 권한만 부여합니다.
- `AUTH_DATABASE_URL`에 관리자·테이블 소유자·BYPASSRLS 계정을 쓰지 않습니다. `APP_DATABASE_URL`은 자녀 업무용이며 0004~0006의 RLS·역할·동의 정책과 실제 검증·삭제 운영 경로 준비 전 실제 아동 데이터를 저장하지 않습니다.
- 적용된 SQL의 체크섬 변경은 실행기가 거절합니다. 마이그레이션은 Vercel 빌드/웹 요청에서 자동 실행하지 않습니다.

## 인증 정책

- 같은 이메일의 소셜 계정을 자동 합치지 않습니다. OAuth state/PKCE(공급자 지원 시), 고정 callback, 최근 인증 후 명시적 연결을 사용합니다.
- 라이브러리 기본 직접 경로 중 계정 삭제·정보 수정·마지막 수단 해제·휴대폰 비밀번호 초기화 등은 차단합니다. 변경은 제한된 계정 API를 이용합니다.
- 세션은 HttpOnly/SameSite=Lax 쿠키, HTTPS에서는 Secure입니다. 최대 30일·비활동 7일·재인증 5분. 캐시된 세션 프로필을 권한 판정에 사용하지 않습니다.
- 업무 요청마다 현재 회원 상태, DB 세션, 세션 수준, 이메일 인증, `access_ready`를 확인합니다. 비밀번호 재인증은 실제 해시 검증 후 새 세션을 발급하고 이전 세션을 폐기합니다.
- OTP는 6자리·180초·실패 5회·재발송 60초. 휴대폰별 시간당 5회/24시간 10회, IP 시간당 20회와 전체 24시간 발송 시도 예산을 PostgreSQL 잠금으로 제한합니다. 해시로 저장하고 원자적으로 소진합니다.
- 최종 로그인 수단 해제는 사용자 행 잠금 안에서 검사합니다. 연결 변경은 다른 기기 세션을 폐기합니다. 인증 응답에는 세션 토큰을 넣지 않습니다.
- 비밀번호 12~128자, 붙여넣기/자동완성 지원. 로컬 저장소에는 큰 글씨 선호만 저장합니다. API·인증 데이터는 오프라인 저장하지 않습니다.
- 미등록 이메일과 등록 이메일의 가입/복구 안내는 동일합니다. 비밀번호·OTP·인증 URL·외부 공급자 오류 원문을 로그에 남기지 않습니다.

## 확인 명령

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

API 테스트는 격리된 PGlite PostgreSQL 엔진에 **운영 SQL 마이그레이션과 실제 Better Auth**를 실행합니다. 발송만 테스트 내 수신함으로 대체합니다. 이 어댑터는 운영 요청 경로에서 불러오지 않습니다. Supabase 실제 접속/TLS/역할 권한, 여러 DB 연결의 경합, OAuth 공급자 로그인·취소·명시적 연결 왕복, 실제 메일·SMS 수신은 외부 연결 후 추가 검증 대상입니다.

브라우저 테스트는 P01 화면과 P02 인증·P03 가족 연결 화면의 경로·준비 상태·320~1440px 화면·큰 글씨·키보드 및 콘솔 오류를 검사합니다. 별도 로컬 테스트 서버(4174)에서 브라우저 가입 → 테스트 수신함의 이메일 확인 → 실제 API 로그인 → 새로고침 → 마지막 수단 보호 → 전체 로그아웃도 확인합니다. 테스트 서버는 배포 API에서 참조하지 않습니다. 한글 폰트는 OFL 라이선스의 Noto Sans KR을 같은 도메인에서 제공합니다.

## 자동 배포

[GitHub 저장소](https://github.com/987654321pjh123-sketch/iharu)는 사용자 지정 공개 저장소입니다. Vercel `iharu` 프로젝트와 Git 연결을 완료했으며 실제 커밋 기반 자동 배포를 확인했습니다. 별도 배포 토큰이나 중복 배포 작업은 필요하지 않습니다.

| 변경 | 동작 |
| --- | --- |
| `main` push/merge | API·인증 테스트 → 타입 검사 → 빌드 → 운영 배포 |
| 다른 브랜치 push | 같은 검사 후 Preview |
| PR 또는 main push | GitHub Actions에서 위 검사와 Chromium 화면 검사 |
| SQL 변경 | 코드만 배포. DB 적용은 위 명령으로 별도 실행 |

브라우저 검사는 GitHub의 추가 검사이며 Vercel 배포를 차단하는 필수 검사로 연결하지 않았습니다. 운영 주소는 [iharu.vercel.app](https://iharu.vercel.app/login), 함수는 Node 24·서울 `icn1`입니다. 배포 성공은 해당 Git SHA와 READY 상태로 판단합니다. 외부 인증 연결 완료 여부는 별도로 판단합니다.

코드 경계: `web/src` / `server/family` / `server/auth` / `server/policy` / `server/domain` / `server/adapters` / `shared` / `db/migrations`.

공식 참조: [Better Auth 계정 연결](https://better-auth.com/docs/concepts/users-accounts), [전화번호 플러그인](https://better-auth.com/docs/plugins/phone-number), [PostgreSQL](https://better-auth.com/docs/adapters/postgresql), [Resend 발송 API](https://resend.com/docs/api-reference/emails/send-email), [SOLAPI](https://solapi.com/developers), [Vercel Git 배포](https://vercel.com/docs/git).

P03 SQL 보안 참고: [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [SECURITY DEFINER 함수](https://www.postgresql.org/docs/current/sql-createfunction.html).
