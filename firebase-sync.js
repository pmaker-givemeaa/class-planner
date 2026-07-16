import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const planner = window.ClassPlanner;
const config = window.FIREBASE_CONFIG || {};
const signInButton = document.getElementById("googleSignInBtn");
const signedInUser = document.getElementById("signedInUser");
const signOutButton = document.getElementById("signOutBtn");
const userName = document.getElementById("userName");
const userPhoto = document.getElementById("userPhoto");

if (!planner || !config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
  signInButton.disabled = true;
  signInButton.textContent = "Firebase 설정 필요";
  signInButton.title = "firebase-config.js에 Firebase 웹 앱 설정을 입력하세요.";
  planner?.setCloudStatus("Firebase 설정 전 · 이 브라우저에 저장됩니다.", false);
} else {
  startFirebaseSync();
}

function startFirebaseSync() {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const provider = new GoogleAuthProvider();
  let currentUser = null;
  let ready = false;
  let syncing = false;
  let pendingState = null;
  let saveTimer = null;
  let lastSettingsHash = "";
  let quarterHashes = new Map();
  let knownQuarterIds = new Set();

  signInButton.addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      if (error.code !== "auth/popup-closed-by-user") {
        alert(loginErrorMessage(error));
      }
    }
  });

  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    try {
      if (ready) await syncState(pendingState || planner.getState());
      await signOut(auth);
    } catch (error) {
      alert("로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      signOutButton.disabled = false;
    }
  });

  document.addEventListener("planner:change", (event) => {
    if (!currentUser || !ready) return;
    pendingState = event.detail.state;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => syncState(pendingState), 800);
  });

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    ready = false;
    pendingState = null;
    window.clearTimeout(saveTimer);
    updateUserUi(user);

    if (!user) {
      planner.setCloudStatus("로그인하면 다른 기기와 동기화됩니다.", false);
      return;
    }

    planner.setCloudStatus("클라우드 데이터를 불러오는 중…", true);
    try {
      await loadOrMigrate(user.uid);
      ready = true;
      planner.setCloudStatus("클라우드 자동 저장 사용 중", true);
    } catch (error) {
      console.error("Firebase 초기 동기화 실패", error);
      planner.setCloudStatus("클라우드 연결 실패 · 로컬에는 저장됩니다.", true);
    }
  });

  function updateUserUi(user) {
    signInButton.classList.toggle("hidden", Boolean(user));
    signedInUser.classList.toggle("hidden", !user);
    if (!user) return;
    userName.textContent = user.displayName || user.email || "로그인됨";
    userName.title = user.email || user.displayName || "";
    userPhoto.src = user.photoURL || "";
    userPhoto.classList.toggle("hidden", !user.photoURL);
  }

  async function loadOrMigrate(uid) {
    const settingsRef = doc(db, "users", uid, "settings", "main");
    const quartersRef = collection(db, "users", uid, "quarters");
    const [settingsSnapshot, quarterSnapshot] = await Promise.all([
      getDoc(settingsRef),
      getDocs(quartersRef)
    ]);

    if (!quarterSnapshot.empty) {
      const settings = settingsSnapshot.exists() ? settingsSnapshot.data() : {};
      const quarters = quarterSnapshot.docs.map((snapshot) => {
        const data = snapshot.data();
        return { id: snapshot.id, name: data.name || "이름 없는 분기", classes: data.classes || [] };
      });
      const activeQuarterId = quarters.some((quarter) => quarter.id === settings.activeQuarterId)
        ? settings.activeQuarterId
        : quarters[0].id;
      const cloudState = {
        version: settings.version || 2,
        activeQuarterId,
        hiddenDays: settings.hiddenDays || [],
        summaryHidden: Boolean(settings.summaryHidden),
        templates: settings.templates || [],
        quarters
      };
      planner.replaceState(cloudState, "클라우드 데이터를 불러왔습니다.");
      captureHashes(cloudState);
      return;
    }

    let stateToUpload = planner.getState();
    if (hasMeaningfulData(stateToUpload)) {
      const useLocal = confirm(
        "이 계정에는 저장된 클라우드 데이터가 없습니다.\n\n" +
        "확인: 이 브라우저의 기존 데이터를 계정에 올립니다.\n" +
        "취소: 이 계정용 빈 플래너로 시작합니다."
      );
      if (!useLocal) {
        stateToUpload = planner.createEmptyState();
        planner.replaceState(stateToUpload);
      }
    }
    lastSettingsHash = "";
    quarterHashes = new Map();
    knownQuarterIds = new Set();
    ready = true;
    await syncState(stateToUpload, true);
  }

  function hasMeaningfulData(state) {
    return state.templates.length > 0 || state.quarters.length > 1 ||
      state.quarters.some((quarter) => quarter.classes.length > 0);
  }

  function settingsFromState(state) {
    return {
      version: state.version || 2,
      activeQuarterId: state.activeQuarterId,
      hiddenDays: state.hiddenDays || [],
      summaryHidden: Boolean(state.summaryHidden),
      templates: state.templates || []
    };
  }

  function quarterData(quarter) {
    return { name: quarter.name, classes: quarter.classes || [], version: 2 };
  }

  function captureHashes(state) {
    lastSettingsHash = JSON.stringify(settingsFromState(state));
    quarterHashes = new Map(state.quarters.map((quarter) => [
      quarter.id,
      JSON.stringify(quarterData(quarter))
    ]));
    knownQuarterIds = new Set(state.quarters.map((quarter) => quarter.id));
  }

  async function syncState(state, force = false) {
    if (!currentUser || !ready) return;
    if (syncing) {
      pendingState = state;
      return;
    }

    syncing = true;
    pendingState = null;
    const uid = currentUser.uid;
    const batch = writeBatch(db);
    let operationCount = 0;
    const settings = settingsFromState(state);
    const settingsHash = JSON.stringify(settings);
    const nextQuarterHashes = new Map();
    const nextQuarterIds = new Set();

    if (force || settingsHash !== lastSettingsHash) {
      batch.set(doc(db, "users", uid, "settings", "main"), {
        ...settings,
        updatedAt: serverTimestamp()
      });
      operationCount += 1;
    }

    state.quarters.forEach((quarter) => {
      const data = quarterData(quarter);
      const hash = JSON.stringify(data);
      nextQuarterIds.add(quarter.id);
      nextQuarterHashes.set(quarter.id, hash);
      if (force || quarterHashes.get(quarter.id) !== hash) {
        batch.set(doc(db, "users", uid, "quarters", quarter.id), {
          ...data,
          updatedAt: serverTimestamp()
        });
        operationCount += 1;
      }
    });

    knownQuarterIds.forEach((quarterId) => {
      if (!nextQuarterIds.has(quarterId)) {
        batch.delete(doc(db, "users", uid, "quarters", quarterId));
        operationCount += 1;
      }
    });

    try {
      if (operationCount > 0) {
        planner.setCloudStatus("클라우드에 저장 중…", true);
        await batch.commit();
      }
      lastSettingsHash = settingsHash;
      quarterHashes = nextQuarterHashes;
      knownQuarterIds = nextQuarterIds;
      planner.setCloudStatus("클라우드에 저장됨", true);
    } catch (error) {
      console.error("Firebase 저장 실패", error);
      planner.setCloudStatus("클라우드 저장 실패 · 로컬에는 저장됨", true);
    } finally {
      syncing = false;
      if (pendingState) {
        const nextState = pendingState;
        pendingState = null;
        syncState(nextState);
      }
    }
  }

  function loginErrorMessage(error) {
    if (error.code === "auth/unauthorized-domain") {
      return "현재 GitHub Pages 도메인이 Firebase Authentication 승인된 도메인에 등록되지 않았습니다.";
    }
    if (error.code === "auth/popup-blocked") {
      return "로그인 팝업이 차단되었습니다. 이 사이트의 팝업을 허용한 뒤 다시 시도해 주세요.";
    }
    return "Google 로그인에 실패했습니다. Firebase 설정과 네트워크 연결을 확인해 주세요.";
  }
}
