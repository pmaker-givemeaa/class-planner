# 수업 플래너

개인용 데스크톱 수업 진도 관리 웹앱입니다. 별도 설치나 서버 없이 사용할 수 있습니다.

## 실행

Windows에서는 `수업플래너 열기.bat`을 더블클릭합니다. 서버 창이 하나 실행되고 앱은 Chrome이나 Edge에서 열립니다. 서버 창은 앱을 사용하는 동안 열어 두고, 다 쓴 뒤 닫으면 됩니다.

`index.html`을 `file:` 주소로 직접 열면 WSL 파일에 대한 브라우저 보안 정책 때문에 저장 기능이 제한될 수 있으므로 배치 파일 실행을 권장합니다.

데이터는 해당 브라우저의 로컬 저장소에 자동 저장됩니다. 브라우저 데이터를 삭제하면 함께 사라질 수 있으므로 앱의 **백업 → 백업 다운로드**를 가끔 사용하세요.

Firebase를 설정하면 Google 계정별로 데이터를 분리해 저장하고, 다른 기기에서도 같은 계정으로 이어서 사용할 수 있습니다. Firebase를 설정하지 않은 상태에서도 기존 로컬 저장 기능은 그대로 작동합니다.

## 주요 기능

- 월~일 요일별 수업 관리
- 필요 없는 요일 숨기기 및 다시 표시
- 개강일과 수업 시각을 기준으로 현재 준비할 차시 자동 계산
- 각 차시의 수업 시작 시각이 지나면 다음 차시로 자동 전환
- 첫 화면에서 이번 주 수업 준비와 테스트 제작 체크
- 차시별 진도·과제 범위 2세트(분할 수업 지원)와 세트별 독립 색상
- 차시별 공용 수업 준비, 테스트 제작, 휴강, 비고
- 첫 차시 테스트 자동 제외
- 분기별 데이터 분리
- 수업 보관함을 통한 다음 분기 재사용
- Google Sheets에서 복사한 표 붙여넣기
- 전체 데이터 JSON 백업 및 복원
- 모바일 요일 탭, 수업 카드와 차시별 카드형 편집 화면

## 시트 붙여넣기 열 순서

첫 번째 열은 진도 1이며, 뒤쪽 열은 선택 사항입니다.

1. 진도 1
2. 수업 준비 완료 (`TRUE`, `완료`, `1` 등)
3. 테스트 제작 완료
4. 과제 범위 1
5. 비고
6. 진도 2
7. 과제 범위 2

## Firebase 클라우드 동기화 설정

### 1. Firebase 프로젝트 준비

1. Firebase Console에서 프로젝트와 웹 앱을 만듭니다.
2. **Authentication → Sign-in method**에서 Google 로그인을 활성화합니다.
3. **Authentication → Settings → Authorized domains**에 GitHub Pages 도메인(예: `사용자명.github.io`)을 추가합니다.
4. Firestore Database를 만듭니다. 운영 모드로 시작해도 됩니다.

### 2. 웹 앱 설정 입력

Firebase Console의 **프로젝트 설정 → 내 앱 → SDK 설정 및 구성**에 표시되는 값을 `firebase-config.js`에 입력합니다.

```javascript
window.FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "프로젝트.firebaseapp.com",
  projectId: "프로젝트",
  storageBucket: "프로젝트.firebasestorage.app",
  messagingSenderId: "...",
  appId: "..."
};
```

이 설정값은 GitHub Pages의 브라우저 코드에 공개되어도 되는 식별자입니다. 실제 데이터 보호는 아래 Firestore 보안 규칙이 담당합니다.

### 3. Firestore 보안 규칙 적용

Firebase Console의 **Firestore Database → Rules**에 `firestore.rules` 내용을 붙여넣고 게시합니다. 규칙은 로그인한 사용자가 자신의 UID 아래 문서만 읽고 쓸 수 있게 제한합니다.

```text
users/{uid}/settings/main
users/{uid}/quarters/{quarterId}
```

- `settings/main`: 현재 분기, 숨긴 요일, 화면 설정, 수업 보관함
- `quarters/{quarterId}`: 분기 이름과 해당 분기의 전체 수업·차시

### 동기화 동작

- 변경 내용은 먼저 `localStorage`에 즉시 저장되고, 약 0.8초 뒤 Firestore에 저장됩니다.
- 처음 로그인한 계정에 클라우드 데이터가 없으면 기존 브라우저 데이터를 올릴지 선택합니다.
- 클라우드 데이터가 있는 계정은 로그인할 때 해당 데이터를 불러옵니다.
- 동일한 Google 계정을 두 기기에서 동시에 수정하면 마지막으로 저장된 변경이 우선합니다.
