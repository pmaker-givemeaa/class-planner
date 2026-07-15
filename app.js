(function () {
  "use strict";

  var STORAGE_KEY = "class-planner-v1";
  var DAYS = ["월", "화", "수", "목", "금", "토", "일"];
  var $ = function (id) { return document.getElementById(id); };
  var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };
  var LESSON_COLORS = [
    { key: "", label: "없음", value: "" },
    { key: "yellow", label: "연노랑", value: "#fff6c7" },
    { key: "green", label: "연초록", value: "#ddf4df" },
    { key: "blue", label: "연하늘", value: "#dff2ff" },
    { key: "pink", label: "연분홍", value: "#ffe3ef" },
    { key: "purple", label: "연보라", value: "#eee4ff" },
    { key: "orange", label: "연주황", value: "#ffe8d2" }
  ];
  var state = loadState();
  var activeClassId = null;
  var editingClassId = null;
  var quarterMode = "add";
  var storageAvailable = true;
  var selectedClassIds = new Set();
  var lessonRefreshTimer = null;

  function initialState() {
    var qid = uid();
    return {
      version: 2,
      activeQuarterId: qid,
      hiddenDays: [],
      summaryHidden: false,
      quarters: [{
        id: qid,
        name: new Date().getFullYear() + "년 " + (Math.floor(new Date().getMonth() / 3) + 1) + "분기",
        classes: []
      }],
      templates: []
    };
  }

  function loadState() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (parsed && Array.isArray(parsed.quarters) && parsed.quarters.length) {
        return normalizeState(parsed);
      }
    } catch (e) {}
    return initialState();
  }

  function normalizeLesson(lesson) {
    if (!("homework" in lesson)) lesson.homework = "";
    if (!("date" in lesson)) lesson.date = "";
    if (!("color" in lesson)) lesson.color = "";
    if (!("topic2" in lesson)) lesson.topic2 = "";
    if (!("homework2" in lesson)) lesson.homework2 = "";
    if (!("color2" in lesson)) lesson.color2 = "";
    return lesson;
  }

  function normalizeState(data) {
    if (!Array.isArray(data.hiddenDays)) data.hiddenDays = [];
    if (!("summaryHidden" in data)) data.summaryHidden = false;
    if (!Array.isArray(data.templates)) data.templates = [];
    data.quarters.forEach(function (quarter) {
      if (!Array.isArray(quarter.classes)) quarter.classes = [];
      quarter.classes.forEach(function (cls) {
        if (!("startDate" in cls)) cls.startDate = "";
        if (!("startTime" in cls)) cls.startTime = "";
        if (!("grade" in cls)) cls.grade = "";
        if (!("book" in cls)) cls.book = "";
        if (!Array.isArray(cls.lessons)) cls.lessons = [];
        cls.lessons.forEach(normalizeLesson);
        fillMissingLessonDates(cls);
        if (cls.grade === "elementary") cls.grade = "elementary6";
        if (["high1", "high2", "high3", "other", ""].indexOf(cls.grade) >= 0) cls.grade = "ungraded";
      });
    });
    data.templates.forEach(function (template) {
      if (!("book" in template)) template.book = "";
      if (!Array.isArray(template.lessons)) {
        template.lessons = (template.topics || []).map(function (topic) {
          return { topic: topic, homework: "" };
        });
      }
      template.lessons.forEach(normalizeLesson);
      if (template.grade === "elementary") template.grade = "elementary6";
      if (!template.grade || ["high1", "high2", "high3", "other"].indexOf(template.grade) >= 0) {
        template.grade = "ungraded";
      }
    });
    data.version = 2;
    return data;
  }

  function saveState(message) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageAvailable = true;
      $("saveStatus").textContent = "방금 자동 저장됨";
    } catch (e) {
      storageAvailable = false;
      $("saveStatus").textContent = "브라우저 저장소를 사용할 수 없습니다. 백업 파일을 이용해 주세요.";
    }
    window.clearTimeout(saveState.timer);
    if (storageAvailable) {
      saveState.timer = window.setTimeout(function () {
        $("saveStatus").textContent = "이 브라우저에 자동 저장됩니다.";
      }, 2200);
    }
    if (message) toast(message);
    renderSummary();
    scheduleLessonRefresh();
  }

  function currentQuarter() {
    return state.quarters.find(function (q) { return q.id === state.activeQuarterId; }) || state.quarters[0];
  }

  function activeClass() {
    return currentQuarter().classes.find(function (c) { return c.id === activeClassId; });
  }

  function selectedClasses() {
    var selected = currentQuarter().classes.filter(function (cls) { return selectedClassIds.has(cls.id); });
    return selected.length ? selected : currentQuarter().classes;
  }

  function makeLesson(topic) {
    return { id: uid(), topic: topic || "", date: "", homework: "", color: "", topic2: "", homework2: "", color2: "", ready: false, test: false, break: false, note: "" };
  }

  function makeLessonFromTemplate(item) {
    var lesson = makeLesson(item && item.topic ? item.topic : "");
    lesson.homework = item && item.homework ? item.homework : "";
    lesson.color = item && item.color ? item.color : "";
    lesson.topic2 = item && item.topic2 ? item.topic2 : "";
    lesson.homework2 = item && item.homework2 ? item.homework2 : "";
    lesson.color2 = item && item.color2 ? item.color2 : "";
    return lesson;
  }

  function splitMatchedLines(text) {
    if (!text.trim()) return [];
    return text.replace(/\r/g, "").split("\n").map(function (v) { return v.trim(); });
  }

  function splitLessonLines(text) {
    var lines = splitMatchedLines(text);
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return lines;
  }

  function templateLessonItems(template) {
    if (Array.isArray(template.lessons)) {
      return template.lessons.map(function (lesson) {
        return { topic: lesson.topic || "", homework: lesson.homework || "", color: lesson.color || "", topic2: lesson.topic2 || "", homework2: lesson.homework2 || "", color2: lesson.color2 || "" };
      });
    }
    return (template.topics || []).map(function (topic) {
      return { topic: topic, homework: "", color: "", topic2: "", homework2: "", color2: "" };
    });
  }

  function dateKey(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function suggestedStartDate(day) {
    var date = new Date();
    var target = DAYS.indexOf(day);
    var mondayBased = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() + target - mondayBased);
    return dateKey(date);
  }

  function parseLocalDate(value) {
    if (!value) return null;
    var parts = value.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function parseLessonDate(value, cls) {
    var text = String(value || "").trim();
    if (!text) return null;
    var full = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (full) return new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]));
    var short = text.match(/^(\d{1,2})[-/.](\d{1,2})$/);
    if (!short) return null;
    var start = parseLocalDate(cls.startDate);
    var year = start ? start.getFullYear() : new Date().getFullYear();
    return new Date(year, Number(short[1]) - 1, Number(short[2]));
  }

  function lessonDateWarning(cls, value) {
    var date = parseLessonDate(value, cls);
    if (!date) return "";
    var expected = DAYS.indexOf(cls.day);
    var actual = (date.getDay() + 6) % 7;
    return expected >= 0 && actual !== expected ? "수업 요일과 다릅니다" : "";
  }

  function lessonScheduledAt(cls, lesson, index) {
    var start = parseLocalDate(cls.startDate);
    if (!start) return null;
    var expected = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    expected.setDate(expected.getDate() + index * 7);
    var text = String(lesson.date || "").trim();
    var scheduled = null;
    var full = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    var short = text.match(/^(\d{1,2})[-/.](\d{1,2})$/);
    if (full) scheduled = new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]));
    else if (short) scheduled = new Date(expected.getFullYear(), Number(short[1]) - 1, Number(short[2]));
    else scheduled = expected;
    var time = String(cls.startTime || "00:00").split(":").map(Number);
    scheduled.setHours(time[0] || 0, time[1] || 0, 0, 0);
    return scheduled;
  }

  function currentLessonInfo(cls, now) {
    if (!cls.startDate) {
      var fallbackIndex = cls.lessons.findIndex(function (lesson) { return !lesson.ready && !lesson.break; });
      return {
        status: "undated",
        index: fallbackIndex < 0 ? Math.max(0, cls.lessons.length - 1) : fallbackIndex,
        sessionDate: null
      };
    }
    if (!cls.lessons.length) return { status: "finished", index: 0, sessionDate: null };
    var currentTime = (now || new Date()).getTime();
    var nextIndex = cls.lessons.findIndex(function (lesson, index) {
      var scheduled = lessonScheduledAt(cls, lesson, index);
      return scheduled && scheduled.getTime() > currentTime;
    });
    if (nextIndex < 0) {
      return {
        status: "finished",
        index: cls.lessons.length - 1,
        sessionDate: lessonScheduledAt(cls, cls.lessons[cls.lessons.length - 1], cls.lessons.length - 1)
      };
    }
    var firstSession = lessonScheduledAt(cls, cls.lessons[0], 0);
    return {
      status: firstSession && currentTime < firstSession.getTime() ? "upcoming" : "active",
      index: nextIndex,
      sessionDate: lessonScheduledAt(cls, cls.lessons[nextIndex], nextIndex)
    };
  }

  function scheduleLessonRefresh() {
    window.clearTimeout(lessonRefreshTimer);
    var now = Date.now();
    var nextStart = null;
    currentQuarter().classes.forEach(function (cls) {
      cls.lessons.forEach(function (lesson, index) {
        var scheduled = lessonScheduledAt(cls, lesson, index);
        var timestamp = scheduled ? scheduled.getTime() : 0;
        if (timestamp > now && (nextStart === null || timestamp < nextStart)) nextStart = timestamp;
      });
    });
    if (nextStart === null) return;
    var delay = Math.min(Math.max(nextStart - now + 50, 50), 2147483000);
    lessonRefreshTimer = window.setTimeout(function () {
      renderSchedule();
      scheduleLessonRefresh();
    }, delay);
  }

  function shortDate(date) {
    return date ? (date.getMonth() + 1) + "/" + date.getDate() : "";
  }

  function autoLessonDate(cls, index) {
    var start = parseLocalDate(cls.startDate);
    if (!start) return "";
    var date = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    date.setDate(date.getDate() + index * 7);
    return shortDate(date);
  }

  function fillMissingLessonDates(cls) {
    if (!cls || !Array.isArray(cls.lessons)) return;
    cls.lessons.forEach(function (lesson, index) {
      if (!lesson.date) lesson.date = autoLessonDate(cls, index);
    });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function lessonColorClass(color) {
    return color ? "lesson-color-" + color : "";
  }

  function lessonColorValue(color) {
    var item = LESSON_COLORS.find(function (candidate) { return candidate.key === color; });
    return item ? item.value : "";
  }

  function paletteButtonHtml(lesson, setNumber) {
    var colorField = setNumber === 2 ? "color2" : "color";
    var color = lesson[colorField] || "";
    var swatches = LESSON_COLORS.map(function (item) {
      var style = item.value ? ' style="background:' + item.value + '"' : "";
      var selected = item.key === color ? " selected" : "";
      return '<button type="button" class="palette-swatch' + selected + (item.key ? "" : " no-color") +
        '" data-lesson-color="' + item.key + '" data-color-set="' + setNumber + '" title="' + item.label + '"' + style + "></button>";
    }).join("");
    return '<button type="button" class="palette-button" data-palette-toggle data-color-set="' + setNumber + '" title="수업 ' + setNumber + ' 색상 선택" aria-label="수업 ' + setNumber + ' 색상 선택">' +
      '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2.4a6.6 6.6 0 0 0 0 13.2h1.1c.9 0 1.4-.9.9-1.6-.4-.7.1-1.5.9-1.5h1A3.4 3.4 0 0 0 16.3 9 6.9 6.9 0 0 0 9 2.4Z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5.8" cy="8" r="1" fill="currentColor"/><circle cx="8.2" cy="5.9" r="1" fill="currentColor"/><circle cx="11.2" cy="6.5" r="1" fill="currentColor"/><circle cx="12.3" cy="9.4" r="1" fill="currentColor"/></svg>' +
      "</button>" +
      '<div class="palette-popover hidden">' + swatches + "</div>";
  }

  function closeLessonPalettes(exceptMenu) {
    document.querySelectorAll(".palette-popover:not(.hidden)").forEach(function (menu) {
      if (!exceptMenu || menu !== exceptMenu) menu.classList.add("hidden");
    });
  }

  function toast(message) {
    var el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(function () { el.classList.remove("show"); }, 2100);
  }

  function fillDaySelects() {
    ["classDay", "pasteDay"].forEach(function (id) {
      $(id).innerHTML = DAYS.map(function (day) {
        return '<option value="' + day + '">' + day + '요일</option>';
      }).join("");
    });
  }

  function render() {
    renderQuarters();
    renderSchedule();
    renderTemplates();
    renderSummary();
    renderOverflowMenu();
    scheduleLessonRefresh();
  }

  function renderQuarters() {
    $("quarterSelect").innerHTML = state.quarters.map(function (q) {
      return '<option value="' + q.id + '">' + escapeHtml(q.name) + "</option>";
    }).join("");
    $("quarterSelect").value = state.activeQuarterId;
  }

  function renderSummary() {
    var classes = currentQuarter().classes;
    var lessons = classes.reduce(function (all, c) { return all.concat(c.lessons); }, []);
    var testEligible = 0;
    var testDone = 0;
    classes.forEach(function (c) {
      c.lessons.forEach(function (l, index) {
        if (index > 0 && !l.break) {
          testEligible += 1;
          if (l.test) testDone += 1;
        }
      });
    });
    var readyEligible = lessons.filter(function (l) { return !l.break; });
    $("classCount").textContent = classes.length;
    $("lessonCount").textContent = lessons.length;
    $("readyCount").textContent = readyEligible.filter(function (l) { return l.ready; }).length + " / " + readyEligible.length;
    $("testCount").textContent = testDone + " / " + testEligible;
    document.querySelector(".summary").classList.toggle("hidden", state.summaryHidden);
    document.querySelector("main").classList.toggle("summary-hidden", state.summaryHidden);
  }

  function renderOverflowMenu() {
    $("toggleSummaryBtn").textContent = state.summaryHidden ? "상태 바 다시 보기" : "상태 바 숨기기";
    $("restoreDaysBtn").textContent = state.hiddenDays.length ?
      "숨긴 요일 " + state.hiddenDays.length + "개 다시 보기" : "숨긴 요일 없음";
    $("restoreDaysBtn").disabled = state.hiddenDays.length === 0;
    $("printTeacherBtn").textContent = selectedClassIds.size ?
      "선택 클래스 인쇄(" + selectedClassIds.size + "개)" : "전체 인쇄";
    $("printTeacherBtn").disabled = currentQuarter().classes.length === 0;
  }

  function renderSchedule() {
    var classes = currentQuarter().classes;
    selectedClassIds.forEach(function (id) {
      if (!classes.some(function (cls) { return cls.id === id; })) selectedClassIds.delete(id);
    });
    var visibleDays = DAYS.filter(function (day) { return state.hiddenDays.indexOf(day) < 0; });
    $("emptySchedule").classList.toggle("hidden", classes.length > 0);
    $("scheduleBoard").classList.toggle("hidden", classes.length === 0);
    $("scheduleBoard").style.gridTemplateColumns = "repeat(" + visibleDays.length + ", minmax(150px, 1fr))";
    $("scheduleBoard").innerHTML = visibleDays.map(function (day) {
      var dayClasses = classes.filter(function (c) { return c.day === day; });
      return '<section class="day-column">' +
        '<div class="day-header"><div class="day-title"><strong>' + day + '요일</strong><span>' + dayClasses.length + '개</span></div>' +
        '<div class="day-actions"><button class="day-hide" data-hide-day="' + day + '" title="' + day + '요일 숨기기">−</button>' +
        '<button class="day-add" data-add-day="' + day + '" title="' + day + '요일 수업 추가">+</button></div></div>' +
        dayClasses.map(classCardHtml).join("") +
        "</section>";
    }).join("");
  }

  function classCardHtml(cls) {
    var current = currentLessonInfo(cls);
    var lesson = cls.lessons[current.index];
    var eligible = cls.lessons.filter(function (l) { return !l.break; });
    var done = eligible.filter(function (l) { return l.ready; }).length;
    var rate = eligible.length ? Math.round(done / eligible.length * 100) : 0;
    var inactive = current.status === "finished" || !lesson;
    var statusText = current.status === "upcoming" ? "개강 전" :
      (current.status === "finished" ? "종강" : (current.index + 1) + "차시");
    var metaText = current.status === "upcoming" ? shortDate(current.sessionDate || parseLocalDate(cls.startDate)) + " 개강 예정" :
      (current.status === "undated" ? "개강일 미설정" : shortDate(current.sessionDate) + " 수업");
    var checkIcon = '<svg class="toggle-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.3 6.4 12 13 4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return '<article class="class-card ' + current.status + " grade-" + escapeHtml(cls.grade || "unset") +
      (selectedClassIds.has(cls.id) ? " selected" : "") + '" data-class-id="' + cls.id + '">' +
      '<span class="lesson-badge">' + statusText + "</span>" +
      "<h3>" + escapeHtml(cls.name) +
      (cls.book ? ' <span class="title-separator">·</span> <span class="book-name">' + escapeHtml(cls.book) + "</span>" : "") +
      "</h3>" +
      '<span class="class-time">' + escapeHtml((cls.startTime || "시각 미설정") + " · " + metaText) + "</span>" +
      '<div class="current-topics"><p>' + escapeHtml(lesson ? (lesson.topic || "진도 미입력") : "등록된 차시 없음") + "</p>" +
      (lesson && lesson.topic2 ? '<p class="secondary-topic"><span>수업 2</span>' + escapeHtml(lesson.topic2) + "</p>" : "") + "</div>" +
      '<div class="card-checks">' +
      '<label class="' + (lesson && lesson.ready ? "checked" : "") + '"><input type="checkbox" data-card-check="ready"' +
      (lesson && lesson.ready ? " checked" : "") + (inactive || lesson.break ? " disabled" : "") +
      '><span>수업 준비</span>' + checkIcon + "</label>" +
      '<label class="test-toggle ' + (lesson && lesson.test ? "checked" : "") + '"><input type="checkbox" data-card-check="test"' +
      (lesson && lesson.test ? " checked" : "") + (inactive || current.index === 0 || lesson.break ? " disabled" : "") +
      '><span>테스트 준비</span>' + checkIcon + "</label></div>" +
      '<div class="progress-track"><div class="progress-bar" style="width:' + rate + '%"></div></div>' +
      '<div class="class-meta"><span>' + done + " / " + eligible.length + '차시 준비</span>' +
      '<button type="button" class="detail-link" data-open-class>자세히 보기 ›</button></div></article>';
  }

  function renderTemplates() {
    $("emptyTemplates").classList.toggle("hidden", state.templates.length > 0);
    $("templateGrid").classList.toggle("hidden", state.templates.length === 0);
    $("templateGrid").innerHTML = state.templates.map(function (t) {
      var items = templateLessonItems(t);
      var preview = items.slice(0, 3).map(function (item) {
        return item.topic2 ? (item.topic || "-") + " / " + item.topic2 : item.topic;
      }).join(" · ");
      return '<article class="template-card">' +
        '<span class="tag">' + items.length + '차시</span>' +
        "<h3>" + escapeHtml(t.name) + "</h3>" +
        "<p>" + escapeHtml(preview || "진도 미입력") + (items.length > 3 ? "…" : "") + "</p>" +
        '<div class="template-actions"><button class="primary" data-template-use="' + t.id + '">현재 분기에 추가</button>' +
        '<button class="danger ghost" data-template-delete="' + t.id + '">삭제</button></div></article>';
    }).join("");
  }

  function openClassDialog(cls, presetDay) {
    editingClassId = cls ? cls.id : null;
    $("classDialogTitle").textContent = cls ? "수업 정보 수정" : "수업 추가";
    $("classDay").value = cls ? cls.day : (presetDay || "월");
    $("className").value = cls ? cls.name : "";
    $("classGrade").value = cls ? (cls.grade || "ungraded") : "ungraded";
    $("classBook").value = cls ? (cls.book || "") : "";
    $("classStartDate").value = cls ? (cls.startDate || "") : suggestedStartDate(presetDay || "월");
    $("classStartTime").value = cls ? (cls.startTime || "") : "10:00";
    $("lessonLines").value = cls ? cls.lessons.map(function (l) { return l.topic; }).join("\n") : "";
    $("homeworkLines").value = cls ? cls.lessons.map(function (l) { return l.homework || ""; }).join("\n") : "";
    $("lessonLines2").value = cls ? cls.lessons.map(function (l) { return l.topic2 || ""; }).join("\n") : "";
    $("homeworkLines2").value = cls ? cls.lessons.map(function (l) { return l.homework2 || ""; }).join("\n") : "";
    $("deleteClassBtn").classList.toggle("hidden", !cls);
    $("classDialog").showModal();
    setTimeout(function () { $("className").focus(); }, 50);
  }

  function saveClassFromForm() {
    var name = $("className").value.trim();
    if (!name) return;
    var topics = splitLessonLines($("lessonLines").value);
    var homeworks = splitMatchedLines($("homeworkLines").value);
    var topics2 = splitLessonLines($("lessonLines2").value);
    var homeworks2 = splitMatchedLines($("homeworkLines2").value);
    var lessonCount = Math.max(topics.length, topics2.length);
    var classes = currentQuarter().classes;
    if (editingClassId) {
      var cls = classes.find(function (c) { return c.id === editingClassId; });
      var previousStartDate = cls.startDate;
      cls.name = name;
      cls.day = $("classDay").value;
      cls.grade = $("classGrade").value;
      cls.book = $("classBook").value.trim();
      cls.startDate = $("classStartDate").value;
      cls.startTime = $("classStartTime").value;
      cls.lessons = Array.from({ length: lessonCount }, function (_, index) {
        var old = cls.lessons[index];
        var topic = topics[index] || "";
        var homework = index < homeworks.length ? homeworks[index] : (old ? old.homework || "" : "");
        var topic2 = topics2[index] || "";
        var homework2 = index < homeworks2.length ? homeworks2[index] : (old ? old.homework2 || "" : "");
        var oldAutoDate = autoLessonDate({ startDate: previousStartDate }, index);
        var shouldRefreshDate = !old || !old.date || old.date === oldAutoDate;
        var date = shouldRefreshDate ? autoLessonDate(cls, index) : old.date;
        return old ? Object.assign({}, old, { topic: topic, date: date, homework: homework, topic2: topic2, homework2: homework2 }) :
          Object.assign(makeLesson(topic), { date: autoLessonDate(cls, index), homework: homework, topic2: topic2, homework2: homework2 });
      });
      fillMissingLessonDates(cls);
    } else {
      var newClass = {
        id: uid(), name: name, day: $("classDay").value,
        grade: $("classGrade").value,
        book: $("classBook").value.trim(),
        startDate: $("classStartDate").value, startTime: $("classStartTime").value,
        lessons: Array.from({ length: lessonCount }, function (_, index) {
          return Object.assign(makeLesson(topics[index] || ""), { homework: homeworks[index] || "", topic2: topics2[index] || "", homework2: homeworks2[index] || "" });
        })
      };
      fillMissingLessonDates(newClass);
      classes.push(newClass);
    }
    saveState("수업을 저장했습니다.");
    render();
  }

  function openLessons(classId) {
    activeClassId = classId;
    var cls = activeClass();
    if (!cls) return;
    $("lessonDialogDay").textContent = cls.day + "요일 · " + cls.lessons.length + "차시";
    $("lessonDialogTitle").textContent = cls.name;
    renderLessonRows();
    if (!$("lessonsDialog").open) $("lessonsDialog").showModal();
  }

  function renderLessonRows() {
    var cls = activeClass();
    if (!cls) return;
    $("lessonTableBody").innerHTML = cls.lessons.map(function (lesson, index) {
      var rowClass = lesson.break ? "break-row" : (lesson.ready ? "done" : "");
      var dateValue = lesson.date || autoLessonDate(cls, index);
      var warning = lessonDateWarning(cls, dateValue);
      return '<tr class="' + rowClass + '" data-lesson-id="' + lesson.id + '">' +
        '<td class="lesson-index-cell"><strong>' + (index + 1) + "</strong></td>" +
        '<td class="date-cell"><input type="text" data-field="date" value="' + escapeHtml(dateValue) + '" placeholder="7/10">' +
        '<span class="date-warning">' + escapeHtml(warning) + "</span></td>" +
        '<td class="lesson-set-cell ' + lessonColorClass(lesson.color) + '"><div class="lesson-set-input">' + paletteButtonHtml(lesson, 1) + '<input type="text" data-field="topic" value="' + escapeHtml(lesson.topic) + '" placeholder="진도 1"></div></td>' +
        '<td><input type="text" data-field="homework" value="' + escapeHtml(lesson.homework || "") + '" placeholder="과제 범위 1"></td>' +
        '<td class="lesson-set-cell second-set ' + lessonColorClass(lesson.color2) + '"><div class="lesson-set-input">' + paletteButtonHtml(lesson, 2) + '<input type="text" data-field="topic2" value="' + escapeHtml(lesson.topic2 || "") + '" placeholder="진도 2"></div></td>' +
        '<td class="second-set"><input type="text" data-field="homework2" value="' + escapeHtml(lesson.homework2 || "") + '" placeholder="과제 범위 2"></td>' +
        '<td class="check-cell"><input type="checkbox" data-field="ready"' + (lesson.ready ? " checked" : "") + (lesson.break ? " disabled" : "") + "></td>" +
        '<td class="check-cell">' + (index === 0 ? '<span class="test-na">첫 차시 없음</span>' :
          '<input type="checkbox" data-field="test"' + (lesson.test ? " checked" : "") + (lesson.break ? " disabled" : "") + ">") + "</td>" +
        '<td class="check-cell"><input type="checkbox" data-field="break"' + (lesson.break ? " checked" : "") + "></td>" +
        '<td><input type="text" data-field="note" value="' + escapeHtml(lesson.note) + '" placeholder="메모"></td>' +
        '<td><button class="row-delete" title="차시 삭제">×</button></td></tr>';
    }).join("");
  }

  function templateLessonData(lesson) {
    return {
      topic: lesson.topic || "", homework: lesson.homework || "", color: lesson.color || "",
      topic2: lesson.topic2 || "", homework2: lesson.homework2 || "", color2: lesson.color2 || ""
    };
  }

  function storeTemplate(cls) {
    var existing = state.templates.find(function (t) { return t.name === cls.name; });
    var topics = cls.lessons.map(function (l) { return l.topic; });
    var lessons = cls.lessons.map(templateLessonData);
    if (existing) {
      existing.topics = topics;
      existing.lessons = lessons;
      existing.grade = cls.grade || "";
      existing.book = cls.book || "";
      existing.updatedAt = new Date().toISOString();
      toast("같은 이름의 보관 수업을 업데이트했습니다.");
    } else {
      state.templates.push({ id: uid(), name: cls.name, grade: cls.grade || "", book: cls.book || "", topics: topics, lessons: lessons, updatedAt: new Date().toISOString() });
      toast("수업을 보관함에 저장했습니다.");
    }
    saveState();
    renderTemplates();
  }

  function escapePrintText(value) {
    return escapeHtml(value || "").replace(/\n/g, "<br>");
  }

  function hasSecondLessonSet(cls) {
    return cls.lessons.some(function (lesson) {
      return Boolean((lesson.topic2 || "").trim() || (lesson.homework2 || "").trim());
    });
  }

  function printLessonSetCells(lesson, setNumber, emptyFallback) {
    var suffix = setNumber === 2 ? "2" : "";
    var color = lesson.break ? "" : lessonColorValue(lesson["color" + suffix]);
    var style = color ? ' style="background:' + color + '"' : "";
    var topic = lesson["topic" + suffix] || emptyFallback || "";
    return "<td" + style + ">" + escapePrintText(topic) + "</td>" +
      "<td>" + escapePrintText(lesson["homework" + suffix] || "") + "</td>";
  }

  function printClass(cls) {
    if (!cls) return;
    var includeSecond = hasSecondLessonSet(cls);
    var rows = cls.lessons.map(function (lesson, index) {
      return '<tr class="' + (lesson.break ? "break-row" : "") + '">' +
        "<td>" + (index + 1) + "</td>" +
        "<td>" + escapePrintText(lesson.date || autoLessonDate(cls, index)) + "</td>" +
        printLessonSetCells(lesson, 1, "진도 미입력") +
        (includeSecond ? printLessonSetCells(lesson, 2, "") : "") +
        "</tr>";
    }).join("");
    var title = escapeHtml(cls.name);
    var html = "<!doctype html><html lang=\"ko\"><head><meta charset=\"UTF-8\"><title>" + title + " 수업 계획표</title>" +
      "<style>" +
      "@page{size:A4 landscape;margin:10mm;}" +
      "body{margin:0;padding:0;color:#17211d;font-family:Pretendard,'Noto Sans KR','Apple SD Gothic Neo',system-ui,sans-serif;}" +
      ".sheet{width:100%;}" +
      "*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}" +
      ".eyebrow{margin:0 0 8px;color:#567064;font-size:11px;font-weight:800;letter-spacing:1.5px;}" +
      "h1{margin:0 0 8px;font-size:24px;letter-spacing:-.7px;}" +
      ".meta{display:flex;align-items:stretch;gap:7px;margin:14px 0 16px;}" +
      ".meta div{flex:0 0 auto;padding:9px 12px;border:1px solid #dce3df;border-radius:8px;background:#f8faf9;}" +
      ".meta span{display:block;margin-bottom:4px;color:#6b756f;font-size:11px;font-weight:800;}" +
      ".meta strong{font-size:14px;}" +
      "table{width:100%;border-collapse:separate;border-spacing:0 5px;table-layout:fixed;}" +
      "th{padding:7px 9px;border:0;border-bottom:1px solid #dce3df;text-align:left;vertical-align:middle;line-height:1.32;font-size:12px;}" +
      "td{padding:7px 9px;border-top:1px solid #dce3df;border-bottom:1px solid #dce3df;background:#fff;text-align:left;vertical-align:middle;line-height:1.32;font-size:12px;}" +
      "td:first-child{border-left:1px solid #dce3df;border-radius:7px 0 0 7px;}td:last-child{border-right:1px solid #dce3df;border-radius:0 7px 7px 0;}" +
      "td+td,th+th{border-left:1px solid #edf1ef;}" +
      "td:nth-child(3),th:nth-child(3),.with-second td:nth-child(5),.with-second th:nth-child(5){border-left:2px solid #cbd8d1;}" +
      "th{background:#edf4f0;color:#234536;font-size:12px;}" +
      "td:first-child,th:first-child{width:42px;text-align:center;}" +
      "td:nth-child(2),th:nth-child(2){width:60px;text-align:center;}" +
      ".single-set td:nth-child(3),.single-set th:nth-child(3){width:58%;}" +
      ".single-set td:nth-child(4),.single-set th:nth-child(4){width:28%;}" +
      ".with-second td:nth-child(3),.with-second th:nth-child(3),.with-second td:nth-child(5),.with-second th:nth-child(5){width:27%;}" +
      ".with-second td:nth-child(4),.with-second th:nth-child(4),.with-second td:nth-child(6),.with-second th:nth-child(6){width:18%;}" +
      "tr.break-row td{background:#e9ecea;color:#6d7671;}" +
      "@media screen{body{padding:24px;background:#eef2ef}.sheet{box-sizing:border-box;max-width:1120px;margin:0 auto;padding:24px;background:white;box-shadow:0 18px 50px rgba(25,43,34,.12);}}" +
      "@media print{body{padding:0}.sheet{max-width:none}}" +
      "</style></head><body><main class=\"sheet\">" +
      "<p class=\"eyebrow\">CLASS PLAN</p><h1>" + title + "</h1>" +
      "<section class=\"meta\">" +
      "<div><span>교재</span><strong>" + escapeHtml(cls.book || "-") + "</strong></div>" +
      "<div><span>수업 요일/시간</span><strong>" + escapeHtml(cls.day + "요일 " + (cls.startTime || "시각 미설정")) + "</strong></div>" +
      "<div><span>개강일</span><strong>" + escapeHtml(cls.startDate || "-") + "</strong></div>" +
      "</section>" +
      '<table class="' + (includeSecond ? "with-second" : "single-set") + '"><thead><tr><th>차시</th><th>날짜</th><th>진도 1</th><th>과제 범위 1</th>' +
      (includeSecond ? "<th>진도 2</th><th>과제 범위 2</th>" : "") + "</tr></thead><tbody>" + rows + "</tbody></table>" +
      "<script>window.addEventListener('load',function(){window.focus();setTimeout(function(){window.print();},150);});<\/script>" +
      "</main></body></html>";
    var win = window.open("", "_blank");
    if (!win) {
      alert("팝업이 차단되어 인쇄창을 열 수 없습니다. 브라우저 팝업 허용 후 다시 시도해 주세요.");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  function compactRowsHtml(cls, includeSecond) {
    return cls.lessons.map(function (lesson, index) {
      return '<tr class="' + (lesson.break ? "break-row" : "") + '">' +
        "<td>" + (index + 1) + "</td>" +
        "<td>" + escapePrintText(lesson.date || autoLessonDate(cls, index)) + "</td>" +
        printLessonSetCells(lesson, 1, "") +
        (includeSecond ? printLessonSetCells(lesson, 2, "") : "") +
        "</tr>";
    }).join("");
  }

  function printTeacherClasses() {
    var classes = selectedClasses();
    if (!classes.length) {
      toast("인쇄할 수업이 없습니다.");
      return;
    }
    var sections = classes.map(function (cls) {
      var includeSecond = hasSecondLessonSet(cls);
      return '<section class="teacher-class">' +
        '<header class="class-line"><h2>' + escapeHtml(cls.name) + "</h2>" +
        '<div class="mini-meta">' +
        '<span><b>교재</b> ' + escapeHtml(cls.book || "-") + "</span>" +
        '<span><b>요일·시간</b> ' + escapeHtml(cls.day + " " + (cls.startTime || "-")) + "</span>" +
        '<span><b>개강일</b> ' + escapeHtml(cls.startDate || "-") + "</span>" +
        "</div></header>" +
        '<table class="' + (includeSecond ? "with-second" : "single-set") + '"><thead><tr><th>차시</th><th>날짜</th><th>진도 1</th><th>과제 1</th>' +
        (includeSecond ? "<th>진도 2</th><th>과제 2</th>" : "") + "</tr></thead><tbody>" +
        compactRowsHtml(cls, includeSecond) + "</tbody></table></section>";
    }).join("");
    var title = selectedClassIds.size ? "선택 클래스 진도표" : "전체 클래스 진도표";
    var html = "<!doctype html><html lang=\"ko\"><head><meta charset=\"UTF-8\"><title>" + title + "</title>" +
      "<style>" +
      "@page{size:A4 portrait;margin:8mm;}" +
      "*{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box;}" +
      "body{margin:0;color:#17211d;font-family:Pretendard,'Noto Sans KR','Apple SD Gothic Neo',system-ui,sans-serif;}" +
      ".sheet{width:100%;}" +
      ".teacher-class{min-height:136mm;padding:0 0 6mm;margin:0 0 6mm;break-inside:avoid;border-bottom:1px dashed #cfd8d2;}" +
      ".teacher-class:nth-child(2n){break-after:page;border-bottom:0;margin-bottom:0;}" +
      ".teacher-class:last-child{break-after:auto;border-bottom:0;}" +
      ".class-line{display:flex;align-items:center;gap:6px;margin:0 0 4px;}" +
      "h2{flex:1 1 auto;margin:0;font-size:13px;line-height:1.25;letter-spacing:-.2px;}" +
      ".mini-meta{display:flex;flex:0 0 auto;gap:4px;align-items:center;}" +
      ".mini-meta span{padding:3px 5px;border:1px solid #dce3df;border-radius:5px;background:#f8faf9;font-size:8.5px;white-space:nowrap;}" +
      ".mini-meta b{color:#617168;font-size:8px;margin-right:2px;}" +
      "table{width:100%;border-collapse:separate;border-spacing:0 3px;table-layout:fixed;}" +
      "th{padding:3px 5px;border:0;border-bottom:1px solid #dce3df;text-align:left;vertical-align:middle;font-size:8.5px;line-height:1.25;}" +
      "td{padding:3px 5px;border-top:1px solid #dce3df;border-bottom:1px solid #dce3df;background:#fff;text-align:left;vertical-align:middle;font-size:8.5px;line-height:1.25;}" +
      "td:first-child{border-left:1px solid #dce3df;border-radius:5px 0 0 5px;}td:last-child{border-right:1px solid #dce3df;border-radius:0 5px 5px 0;}" +
      "td+td,th+th{border-left:1px solid #edf1ef;}" +
      "td:nth-child(3),th:nth-child(3),.with-second td:nth-child(5),.with-second th:nth-child(5){border-left:1.5px solid #cbd8d1;}" +
      "th{background:#edf4f0;color:#234536;font-weight:800;}" +
      "td:first-child,th:first-child{width:30px;text-align:center;}" +
      "td:nth-child(2),th:nth-child(2){width:42px;text-align:center;}" +
      ".single-set td:nth-child(3),.single-set th:nth-child(3){width:52%;}" +
      ".single-set td:nth-child(4),.single-set th:nth-child(4){width:35%;}" +
      ".with-second td:nth-child(3),.with-second th:nth-child(3),.with-second td:nth-child(5),.with-second th:nth-child(5){width:27%;}" +
      ".with-second td:nth-child(4),.with-second th:nth-child(4),.with-second td:nth-child(6),.with-second th:nth-child(6){width:17%;}" +
      "tr.break-row td{background:#e9ecea;color:#6d7671;}" +
      "@media screen{body{padding:24px;background:#eef2ef}.sheet{max-width:794px;margin:0 auto;padding:24px;background:white;box-shadow:0 18px 50px rgba(25,43,34,.12);}}" +
      "@media print{body{padding:0}.sheet{max-width:none}}" +
      "</style></head><body><main class=\"sheet\">" + sections +
      "<script>window.addEventListener('load',function(){window.focus();setTimeout(function(){window.print();},150);});<\/script>" +
      "</main></body></html>";
    var win = window.open("", "_blank");
    if (!win) {
      alert("팝업이 차단되어 인쇄창을 열 수 없습니다. 브라우저 팝업 허용 후 다시 시도해 주세요.");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  function parsePastedRows(text) {
    return text.split(/\r?\n/).map(function (line) {
      var cells = line.split("\t").map(function (cell) { return cell.trim(); });
      return cells;
    }).filter(function (cells) { return cells.some(Boolean); });
  }

  document.addEventListener("click", function (e) {
    if (!e.target.closest(".lesson-set-cell")) closeLessonPalettes();
    var close = e.target.closest("[data-close]");
    if (close) $(close.dataset.close).close();
    if (e.target.closest('[data-action="add-class"]')) openClassDialog();

    var dayAdd = e.target.closest("[data-add-day]");
    if (dayAdd) openClassDialog(null, dayAdd.dataset.addDay);

    var dayHide = e.target.closest("[data-hide-day]");
    if (dayHide) {
      state.hiddenDays.push(dayHide.dataset.hideDay);
      saveState(dayHide.dataset.hideDay + "요일을 숨겼습니다.");
      renderSchedule();
      renderOverflowMenu();
    }

    var openDetail = e.target.closest("[data-open-class]");
    if (openDetail) {
      openLessons(openDetail.closest("[data-class-id]").dataset.classId);
      return;
    }

    var card = e.target.closest("[data-class-id]");
    if (card && !e.target.closest(".card-checks")) {
      var id = card.dataset.classId;
      if (selectedClassIds.has(id)) selectedClassIds.delete(id);
      else selectedClassIds.add(id);
      renderSchedule();
      renderOverflowMenu();
      return;
    }

    var use = e.target.closest("[data-template-use]");
    if (use) {
      var template = state.templates.find(function (t) { return t.id === use.dataset.templateUse; });
      var items = templateLessonItems(template);
      currentQuarter().classes.push({
        id: uid(), name: template.name, day: "월",
        grade: template.grade || "ungraded",
        book: template.book || "",
        startDate: suggestedStartDate("월"), startTime: "10:00",
        lessons: items.map(makeLessonFromTemplate)
      });
      fillMissingLessonDates(currentQuarter().classes[currentQuarter().classes.length - 1]);
      saveState("월요일에 수업을 추가했습니다. 필요하면 요일을 수정하세요.");
      render();
    }

    var del = e.target.closest("[data-template-delete]");
    if (del && confirm("이 보관 수업을 삭제할까요?")) {
      state.templates = state.templates.filter(function (t) { return t.id !== del.dataset.templateDelete; });
      saveState("보관 수업을 삭제했습니다.");
      renderTemplates();
    }
  });

  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("active"); });
      document.querySelectorAll(".panel").forEach(function (x) { x.classList.remove("active"); });
      tab.classList.add("active");
      $(tab.dataset.tab + "Panel").classList.add("active");
    });
  });

  $("overflowMenuBtn").addEventListener("click", function (e) {
    e.stopPropagation();
    var willOpen = $("overflowMenu").classList.contains("hidden");
    $("overflowMenu").classList.toggle("hidden", !willOpen);
    $("overflowMenuBtn").setAttribute("aria-expanded", String(willOpen));
  });
  $("overflowMenu").addEventListener("click", function (e) { e.stopPropagation(); });
  document.addEventListener("click", function () {
    $("overflowMenu").classList.add("hidden");
    $("overflowMenuBtn").setAttribute("aria-expanded", "false");
  });
  $("toggleSummaryBtn").addEventListener("click", function () {
    state.summaryHidden = !state.summaryHidden;
    saveState();
    renderSummary();
    renderOverflowMenu();
  });
  $("printTeacherBtn").addEventListener("click", function () {
    $("overflowMenu").classList.add("hidden");
    printTeacherClasses();
  });

  $("quarterSelect").addEventListener("change", function () {
    state.activeQuarterId = this.value;
    selectedClassIds.clear();
    saveState();
    render();
  });
  $("addQuarterBtn").addEventListener("click", function () {
    quarterMode = "add";
    $("quarterDialogTitle").textContent = "새 분기";
    $("quarterName").value = "";
    $("deleteQuarterBtn").classList.add("hidden");
    $("quarterDialog").showModal();
  });
  $("quarterMenuBtn").addEventListener("click", function () {
    $("overflowMenu").classList.add("hidden");
    quarterMode = "edit";
    $("quarterDialogTitle").textContent = "분기 관리";
    $("quarterName").value = currentQuarter().name;
    $("deleteQuarterBtn").classList.toggle("hidden", state.quarters.length < 2);
    $("quarterDialog").showModal();
  });
  $("quarterForm").addEventListener("submit", function (e) {
    if (e.submitter && e.submitter.value === "save") {
      var name = $("quarterName").value.trim();
      if (quarterMode === "add") {
        var q = { id: uid(), name: name, classes: [] };
        state.quarters.push(q);
        state.activeQuarterId = q.id;
      } else currentQuarter().name = name;
      saveState("분기를 저장했습니다.");
      render();
    }
  });
  $("deleteQuarterBtn").addEventListener("click", function () {
    if (state.quarters.length > 1 && confirm("현재 분기와 모든 수업을 삭제할까요?")) {
      state.quarters = state.quarters.filter(function (q) { return q.id !== state.activeQuarterId; });
      state.activeQuarterId = state.quarters[0].id;
      $("quarterDialog").close();
      saveState("분기를 삭제했습니다.");
      render();
    }
  });

  $("restoreDaysBtn").addEventListener("click", function () {
    state.hiddenDays = [];
    saveState("숨긴 요일을 모두 표시했습니다.");
    renderSchedule();
    renderOverflowMenu();
    $("overflowMenu").classList.add("hidden");
  });
  $("classDay").addEventListener("change", function () {
    if (!editingClassId) $("classStartDate").value = suggestedStartDate(this.value);
  });
  document.querySelectorAll("[data-quick-time]").forEach(function (button) {
    button.addEventListener("click", function () {
      $("classStartTime").value = button.dataset.quickTime;
    });
  });
  $("classForm").addEventListener("submit", function (e) {
    if (e.submitter && e.submitter.value === "save") saveClassFromForm();
  });
  $("deleteClassBtn").addEventListener("click", function () {
    if (!editingClassId || !confirm("이 수업과 모든 차시를 삭제할까요?")) return;
    currentQuarter().classes = currentQuarter().classes.filter(function (c) { return c.id !== editingClassId; });
    $("classDialog").close();
    $("lessonsDialog").close();
    saveState("수업을 삭제했습니다.");
    render();
  });
  $("editClassBtn").addEventListener("click", function () {
    var cls = activeClass();
    $("lessonsDialog").close();
    openClassDialog(cls);
  });
  $("storeClassBtn").addEventListener("click", function () { storeTemplate(activeClass()); });
  $("printClassBtn").addEventListener("click", function () { printClass(activeClass()); });
  $("saveAllTemplatesBtn").addEventListener("click", function () {
    currentQuarter().classes.forEach(function (cls) {
      var existing = state.templates.find(function (t) { return t.name === cls.name; });
      var topics = cls.lessons.map(function (l) { return l.topic; });
      var lessons = cls.lessons.map(templateLessonData);
      if (existing) {
        existing.topics = topics;
        existing.lessons = lessons;
        existing.grade = cls.grade || "";
        existing.book = cls.book || "";
        existing.updatedAt = new Date().toISOString();
      } else {
        state.templates.push({ id: uid(), name: cls.name, grade: cls.grade || "", book: cls.book || "", topics: topics, lessons: lessons, updatedAt: new Date().toISOString() });
      }
    });
    saveState("현재 분기의 모든 수업을 보관했습니다.");
    renderTemplates();
  });

  $("lessonTableBody").addEventListener("change", function (e) {
    var row = e.target.closest("tr");
    var lesson = activeClass().lessons.find(function (l) { return l.id === row.dataset.lessonId; });
    var field = e.target.dataset.field;
    if (!field) return;
    lesson[field] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (field === "break" && lesson.break) {
      lesson.ready = false;
      lesson.test = false;
    }
    saveState();
    renderLessonRows();
    renderSchedule();
  });
  $("lessonTableBody").addEventListener("input", function (e) {
    var field = e.target.dataset.field;
    if (["date", "topic", "homework", "topic2", "homework2", "note"].indexOf(field) < 0) return;
    var row = e.target.closest("tr");
    var lesson = activeClass().lessons.find(function (l) { return l.id === row.dataset.lessonId; });
    lesson[field] = e.target.value;
    if (field === "date") {
      var warning = row.querySelector(".date-warning");
      if (warning) warning.textContent = lessonDateWarning(activeClass(), e.target.value);
    }
    saveState();
  });
  $("lessonTableBody").addEventListener("click", function (e) {
    var paletteToggle = e.target.closest("[data-palette-toggle]");
    if (paletteToggle) {
      var menu = paletteToggle.parentElement.querySelector(".palette-popover");
      var willOpen = menu.classList.contains("hidden");
      closeLessonPalettes(menu);
      menu.classList.toggle("hidden", !willOpen);
      return;
    }
    var swatch = e.target.closest("[data-lesson-color]");
    if (swatch) {
      var colorRow = swatch.closest("tr");
      var colorLesson = activeClass().lessons.find(function (l) { return l.id === colorRow.dataset.lessonId; });
      colorLesson[swatch.dataset.colorSet === "2" ? "color2" : "color"] = swatch.dataset.lessonColor;
      saveState();
      renderLessonRows();
      return;
    }
    if (!e.target.classList.contains("row-delete")) return;
    var row = e.target.closest("tr");
    activeClass().lessons = activeClass().lessons.filter(function (l) { return l.id !== row.dataset.lessonId; });
    saveState("차시를 삭제했습니다.");
    openLessons(activeClassId);
    renderSchedule();
  });

  $("scheduleBoard").addEventListener("change", function (e) {
    var field = e.target.dataset.cardCheck;
    if (!field) return;
    var card = e.target.closest("[data-class-id]");
    var cls = currentQuarter().classes.find(function (item) { return item.id === card.dataset.classId; });
    var info = currentLessonInfo(cls);
    var lesson = cls.lessons[info.index];
    if (!lesson) return;
    lesson[field] = e.target.checked;
    saveState();
    renderSchedule();
  });
  $("addLessonBtn").addEventListener("click", function () {
    var cls = activeClass();
    var lesson = makeLesson("");
    lesson.date = autoLessonDate(cls, cls.lessons.length);
    cls.lessons.push(lesson);
    saveState();
    renderLessonRows();
    var rows = $("lessonTableBody").querySelectorAll("tr");
    if (rows.length) rows[rows.length - 1].querySelector('[data-field="topic"]').focus();
  });

  $("pasteBtn").addEventListener("click", function () {
    $("overflowMenu").classList.add("hidden");
    $("pasteClassName").value = "";
    $("pasteArea").value = "";
    $("pastePreview").textContent = "붙여넣으면 가져올 차시 수를 표시합니다.";
    $("pasteDialog").showModal();
  });
  $("pasteArea").addEventListener("input", function () {
    var rows = parsePastedRows(this.value);
    $("pastePreview").textContent = rows.length + "개 행을 차시로 가져옵니다.";
  });
  $("pasteForm").addEventListener("submit", function (e) {
    if (!e.submitter || e.submitter.value !== "import") return;
    var rows = parsePastedRows($("pasteArea").value);
    var lessons = rows.map(function (cells, index) {
      var lesson = makeLesson(cells[0]);
      var bool = function (value) { return /^(true|yes|1|완료|v|o)$/i.test(value || ""); };
      if (cells.length > 1) lesson.ready = bool(cells[1]);
      if (cells.length > 2 && index > 0) lesson.test = bool(cells[2]);
      if (cells.length > 3) lesson.homework = cells[3] || "";
      if (cells.length > 4) lesson.note = cells[4] || "";
      if (cells.length > 5) lesson.topic2 = cells[5] || "";
      if (cells.length > 6) lesson.homework2 = cells[6] || "";
      return lesson;
    });
    var pastedClass = {
      id: uid(), name: $("pasteClassName").value.trim(),
      day: $("pasteDay").value,
      grade: "ungraded",
      book: "",
      startDate: suggestedStartDate($("pasteDay").value), startTime: "10:00",
      lessons: lessons
    };
    fillMissingLessonDates(pastedClass);
    currentQuarter().classes.push(pastedClass);
    saveState(rows.length + "개 차시를 가져왔습니다.");
    render();
  });

  $("exportBtn").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "수업플래너_백업_" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(url);
    toast("백업 파일을 저장했습니다.");
  });
  $("importInput").addEventListener("change", function () {
    var file = this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data.quarters || !Array.isArray(data.templates)) throw new Error("invalid");
        if (confirm("현재 데이터를 백업 파일로 교체할까요?")) {
          state = normalizeState(data);
          saveState("백업을 복원했습니다.");
          render();
        }
      } catch (e) { alert("올바른 수업 플래너 백업 파일이 아닙니다."); }
      $("importInput").value = "";
    };
    reader.readAsText(file);
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      renderSchedule();
      scheduleLessonRefresh();
    }
  });
  window.addEventListener("focus", function () {
    renderSchedule();
    scheduleLessonRefresh();
  });

  fillDaySelects();
  render();
})();
