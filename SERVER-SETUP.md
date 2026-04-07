# Server-first setup

서버 PC에서 처음 설치할 때만 필요한 단계입니다.

**중요:** 0_CopyForTransfer.bat으로 복사한 폴더를 서버에 붙여넣은 경우, 서버에서 **반드시 1_Setup.bat을 실행**하세요. 복사본에는 `.next`(빌드 결과)가 없어서 1_Setup.bat 없이 2_Start.bat만 실행하면 `/login`·설정 등이 404로 나올 수 있습니다.

## 1. 사전 요구사항

- Node.js LTS 설치
- PostgreSQL 설치 및 서비스 실행 (port 5432)
- DB `projectmanagepro` 생성 (없으면 `createdb -U postgres projectmanagepro` 또는 pgAdmin에서 생성)

## 2. 설치 실행

1. 프로젝트 폴더에서 **1_Setup.bat** 실행
2. "Is this PC the SERVER? (Y/N)" → **Y** 입력
3. PostgreSQL 사용자 `postgres` 비밀번호 입력 (Enter 시 기본값 `postgres`)
4. 설치가 끝날 때까지 대기 (npm install, .env 생성, prisma push, seed, build)

## 3. 최초 로그인

- URL: `http://localhost:3000` (또는 서버 IP:3000)
- **아이디:** admin  
- **비밀번호:** admin123 (시드 기본값)

비밀번호를 바꾸려면 시드 실행 전에 환경변수 `ADMIN_INITIAL_PASSWORD`를 설정한 뒤 `npm run db:seed` 실행.

## 4. 사용자 추가

- 관리자(admin)로 로그인 후 **설정(톱니바퀴)** → **사용자 관리**에서 아이디/비밀번호로 사용자 추가
- 이렇게 추가된 계정만 로그인할 수 있습니다 (자가 가입 없음)

## 5. 앱 실행

- **2_Start.bat** 실행 후 브라우저에서 접속
- 로그인한 상태는 7일간 유지됩니다 (HTTP에서도 쿠키 동작). HTTPS 사용 시 `.env`에 `SECURE_COOKIE=true` 추가 권장.

## 6. 문제 해결 (로그인/설정 404)

- **/login 또는 설정 페이지가 404인 경우:** 서버에서 **1_Setup.bat**을 한 번 실행한 뒤 **2_Start.bat**으로 앱을 띄우세요. 붙여넣기만 하고 1_Setup.bat을 실행하지 않으면 빌드(.next)가 없어 라우트가 동작하지 않습니다.
- **설정 버튼이 안 보이는 경우:** 프로젝트 목록·프로젝트 상세 상단 헤더에서 톱니 아이콘(설정)을 찾으세요. 화면이 좁으면 버튼이 다음 줄로 내려갈 수 있습니다.
- 프록시/CDN을 쓰는 경우: `/login`, `/api/auth/*` 경로는 캐시하지 않도록 설정하는 것을 권장합니다.
