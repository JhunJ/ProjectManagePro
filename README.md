# ProjectManagePro

웹 기반 공정/프로젝트 관리 시스템(MVP+)입니다. MS Project 스타일의 작업/의존관계/진척률/마일스톤 관리를 웹에서 직관적으로 운영하도록 설계했습니다.

## 핵심 기능

- 프로젝트 CRUD + 프로젝트별 공정표 관리
- 작업(Task) CRUD + 트리 구조(parent/child)
- Gantt 차트 중심 편집
  - 작업 바 드래그(이동)
  - 작업 바 리사이즈(기간 변경)
  - 진척률 오버레이
  - 마일스톤 다이아몬드 렌더링
- 작업 순서 Drag & Drop(dnd-kit)
- 의존관계(FS/SS/FF/SF + lagDays) 생성/삭제/수정
- 의존관계 선 시각화(SVG)
- 의존관계 변경 시 후행 작업 자동 연쇄 재계산
- 주5일 기본 캘린더 + 프로젝트별 요일 근무 토글
- 주말 자동 스킵 영업일 계산
- 필터/검색/정렬 + day/week/month 줌
- 다크/라이트 모드
- Undo/Redo(세션 내), 자동저장(디바운스)

## 기술 스택

- Frontend: Next.js(App Router), React, TypeScript
- Styling: Tailwind CSS(v4), shadcn 스타일 커스텀 컴포넌트
- Interaction: Framer Motion, dnd-kit
- Server state: TanStack Query
- UI state: Zustand
- DB: PostgreSQL(Supabase 권장)
- ORM: Prisma

## 폴더 구조

```text
src/
  app/
    api/                         # Route Handlers
    projects/                    # 프로젝트 목록/상세 페이지
  components/
    ui/                          # 재사용 UI primitives
    shared/
  features/
    projects/                    # 목록/상세 화면 로직
    tasks/                       # 트리/상세 패널
    gantt/                       # 간트 렌더링/드래그/타임라인
  lib/
    api-client.ts                # 클라이언트 API
    prisma.ts                    # Prisma singleton
    validations/                 # zod 스키마
  server/
    schedulers/                  # 영업일/의존성 재계산 엔진
    services/                    # 스케줄 조회/저장 서비스
  stores/
    gantt-store.ts               # 줌/선택/필터/Undo/Redo/저장상태
  types/
prisma/
  schema.prisma
  seed.ts
  migrations/
```

## 데이터 모델

- `Project`
- `Task`
- `Dependency` (FS/SS/FF/SF)
- `WorkingCalendar`

확장 포인트(후속): `Holiday`, `Resource`, `Baseline`, `ActivityLog`, `FileAttachment`

## API

- `GET/POST /api/projects`
- `GET/PATCH/DELETE /api/projects/:id`
- `GET/POST /api/projects/:id/tasks`
- `PATCH/DELETE /api/tasks/:id`
- `POST /api/projects/:id/tasks/reorder`
- `GET/POST /api/projects/:id/dependencies`
- `PATCH/DELETE /api/dependencies/:id`
- `GET/PATCH /api/projects/:id/calendar`
- `POST /api/projects/:id/schedule/recalculate`

## 실행 방법

### 1) 환경 변수

`.env` 파일 생성:

```bash
cp .env.example .env
```

`DATABASE_URL`, `DIRECT_URL`에 Supabase Postgres 연결 문자열 입력

### 2) 설치

```bash
npm install
```

### 3) Prisma

```bash
npm run db:generate
npm run db:deploy
npm run db:seed
```

개발 중 로컬 migration 생성 시:

```bash
npm run db:migrate
```

### 4) 개발 서버

```bash
npm run dev
```

- 프로젝트 목록: `http://localhost:3000/projects`

## Seed 데이터

기본 프로젝트 + 아래 공정이 FS 연쇄로 생성됩니다.

`문 → 내부기둥 → 조적, 골조 → SAW CUTTING, 바닥배수판 → REVIT 연동 → 객체생성 → 속성 자동 입력`

기본 캘린더: 월~금 근무, 토/일 휴무

## 테스트

```bash
npm run test
```

포함:
- 영업일 계산 단위 테스트
- 의존성 연쇄/순환 감지 단위 테스트

## 향후 확장 가이드

- 인증 확장: NextAuth + 사용자/권한 모델 추가
- 실시간 협업: WebSocket/Supabase Realtime + optimistic conflict 전략
- CSV/Excel import-export: `features/import-export` 모듈 추가
- Holiday 테이블 추가 후 `business-days.ts`에 공휴일 제외 로직 확장
- 대규모 데이터 최적화: 좌우 패널 동시 row virtualization + canvas 렌더링 옵션

## 배포

- Frontend: Vercel
- Database: Supabase Postgres
- Prisma: `db:deploy` 실행 후 배포
