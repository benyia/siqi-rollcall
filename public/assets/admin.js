(() => {
  "use strict";

  const loadingView = document.getElementById("loadingView");
  const loginView = document.getElementById("loginView");
  const adminView = document.getElementById("adminView");
  const loginForm = document.getElementById("loginForm");
  const passwordInput = document.getElementById("passwordInput");
  const loginButton = document.getElementById("loginButton");
  const loginError = document.getElementById("loginError");

  const adminClassCount = document.getElementById("adminClassCount");
  const adminClassList = document.getElementById("adminClassList");
  const newClassBtn = document.getElementById("newClassBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  const editorTitle = document.getElementById("editorTitle");
  const openClassLink = document.getElementById("openClassLink");
  const classForm = document.getElementById("classForm");
  const classNameInput = document.getElementById("classNameInput");
  const classDescriptionInput = document.getElementById("classDescriptionInput");
  const sortOrderInput = document.getElementById("sortOrderInput");
  const studentInput = document.getElementById("studentInput");
  const rosterCount = document.getElementById("rosterCount");
  const saveClassBtn = document.getElementById("saveClassBtn");
  const deleteClassBtn = document.getElementById("deleteClassBtn");
  const editorStatus = document.getElementById("editorStatus");
  const toast = document.getElementById("toast");

  const state = {
    classes: [],
    selectedId: null,
    deleteArmed: false
  };

  let toastTimer = null;
  let deleteTimer = null;

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2400);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      },
      ...options
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok) {
      throw new ApiError(data.error || "请求失败，请稍后重试", response.status);
    }
    return data;
  }

  function showLogin(message = "") {
    loadingView.hidden = true;
    adminView.hidden = true;
    loginView.hidden = false;
    loginError.textContent = message;
    loginButton.disabled = false;
    loginButton.textContent = "进入后台";
    passwordInput.focus({ preventScroll: true });
  }

  function showAdmin() {
    loadingView.hidden = true;
    loginView.hidden = true;
    adminView.hidden = false;
  }

  function handleApiError(error) {
    if (error instanceof ApiError && error.status === 401) {
      showLogin("登录已过期，请重新输入密码。");
      return;
    }
    showToast(error.message || "操作失败");
  }

  function disarmDelete() {
    window.clearTimeout(deleteTimer);
    state.deleteArmed = false;
    deleteClassBtn.classList.remove("is-armed");
    deleteClassBtn.textContent = "删除班级";
  }

  function resetForm() {
    disarmDelete();
    state.selectedId = null;
    classForm.reset();
    sortOrderInput.value = "0";
    editorTitle.textContent = "新建班级";
    openClassLink.hidden = true;
    deleteClassBtn.hidden = true;
    editorStatus.textContent = "";
    rosterCount.textContent = "0 人";
    renderClassList();
    classNameInput.focus({ preventScroll: true });
  }

  function cleanStudentCount() {
    const seen = new Set();
    studentInput.value.split(/\r?\n/).forEach((line) => {
      const name = line
        .trim()
        .replace(/^(?:\d{1,3}[.、)．]\s*|[-*•·]\s*)/, "")
        .trim();
      if (name) {
        seen.add(name.slice(0, 40));
      }
    });
    rosterCount.textContent = `${seen.size} 人`;
  }

  function formatUpdatedAt(value) {
    if (!value) {
      return "刚刚";
    }
    const normalized = value.includes("T")
      ? value
      : `${value.replace(" ", "T")}Z`;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function renderClassList() {
    adminClassCount.textContent = `${state.classes.length} 个`;
    adminClassList.replaceChildren();
    if (!state.classes.length) {
      const empty = document.createElement("p");
      empty.className = "sidebar-empty";
      empty.textContent = "还没有班级，点击上方“新建班级”开始。";
      adminClassList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    state.classes.forEach((classItem) => {
      const button = document.createElement("button");
      const name = document.createElement("strong");
      const meta = document.createElement("span");
      button.type = "button";
      button.className = "admin-class-item";
      if (Number(classItem.id) === state.selectedId) {
        button.classList.add("is-active");
      }
      name.textContent = classItem.name;
      meta.textContent = `${Number(classItem.student_count) || 0} 位同学 · 排序 ${Number(classItem.sort_order) || 0}`;
      button.append(name, meta);
      button.addEventListener("click", () => selectClass(Number(classItem.id), {
        scrollToEditor: true
      }));
      fragment.append(button);
    });
    adminClassList.append(fragment);
  }

  function fillEditor(classData) {
    disarmDelete();
    state.selectedId = Number(classData.id);
    classNameInput.value = classData.name;
    classDescriptionInput.value = classData.description || "";
    sortOrderInput.value = String(Number(classData.sort_order) || 0);
    studentInput.value = (classData.students || []).join("\n");
    editorTitle.textContent = classData.name;
    openClassLink.href = `/?class=${encodeURIComponent(classData.id)}`;
    openClassLink.hidden = false;
    deleteClassBtn.hidden = false;
    editorStatus.textContent = `最后保存：${formatUpdatedAt(classData.updated_at)}`;
    cleanStudentCount();
    renderClassList();
  }

  async function selectClass(id, { scrollToEditor = false } = {}) {
    if (!Number.isInteger(id) || id <= 0) {
      return;
    }
    try {
      const data = await api(`/api/classes/${id}`);
      fillEditor(data.class);
      if (scrollToEditor && window.matchMedia("(max-width: 820px)").matches) {
        document.querySelector(".admin-editor").scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    } catch (error) {
      handleApiError(error);
    }
  }

  async function loadClasses({ preferredId = null } = {}) {
    try {
      const data = await api("/api/admin/classes");
      state.classes = Array.isArray(data.classes) ? data.classes : [];
      renderClassList();

      const queryId = Number(new URLSearchParams(location.search).get("class"));
      const targetId = preferredId
        || (Number.isInteger(queryId) && queryId > 0 ? queryId : null)
        || state.selectedId;
      const targetExists = state.classes.some(
        (classItem) => Number(classItem.id) === Number(targetId)
      );

      if (targetExists) {
        await selectClass(Number(targetId));
      } else if (state.classes.length) {
        await selectClass(Number(state.classes[0].id));
      } else {
        resetForm();
      }
    } catch (error) {
      handleApiError(error);
    }
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";
    loginButton.disabled = true;
    loginButton.textContent = "正在登录…";
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password: passwordInput.value })
      });
      passwordInput.value = "";
      showAdmin();
      await loadClasses();
    } catch (error) {
      loginError.textContent = error.message || "登录失败";
      loginButton.disabled = false;
      loginButton.textContent = "进入后台";
      passwordInput.focus({ preventScroll: true });
    }
  });

  logoutBtn.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      return;
    }
    showLogin("已退出登录。");
    passwordInput.value = "";
  });

  newClassBtn.addEventListener("click", resetForm);

  studentInput.addEventListener("input", () => {
    cleanStudentCount();
    editorStatus.textContent = "有未保存的修改";
  });

  classNameInput.addEventListener("input", () => {
    editorStatus.textContent = "有未保存的修改";
  });

  classDescriptionInput.addEventListener("input", () => {
    editorStatus.textContent = "有未保存的修改";
  });

  sortOrderInput.addEventListener("input", () => {
    editorStatus.textContent = "有未保存的修改";
  });

  classForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = classNameInput.value.trim();
    if (!name) {
      classNameInput.setCustomValidity("请填写班级名称");
      classNameInput.reportValidity();
      classNameInput.setCustomValidity("");
      return;
    }
    if (!studentInput.value.trim()) {
      showToast("还没有学生，仍可保存空班级");
    }

    saveClassBtn.disabled = true;
    editorStatus.textContent = "正在保存…";
    const payload = {
      name,
      description: classDescriptionInput.value.trim(),
      sort_order: Number(sortOrderInput.value) || 0,
      students: studentInput.value
    };

    try {
      const isNew = !state.selectedId;
      const data = await api(
        isNew ? "/api/admin/classes" : `/api/admin/classes/${state.selectedId}`,
        {
          method: isNew ? "POST" : "PUT",
          body: JSON.stringify(payload)
        }
      );
      const id = Number(data.class.id);
      state.selectedId = id;
      history.replaceState({}, "", `?class=${id}`);
      await loadClasses({ preferredId: id });
      showToast(isNew ? "班级已创建" : "班级已保存");
      editorStatus.textContent = "已保存";
    } catch (error) {
      handleApiError(error);
      editorStatus.textContent = "保存失败";
    } finally {
      saveClassBtn.disabled = false;
    }
  });

  deleteClassBtn.addEventListener("click", async () => {
    if (!state.selectedId) {
      return;
    }
    if (!state.deleteArmed) {
      state.deleteArmed = true;
      deleteClassBtn.classList.add("is-armed");
      deleteClassBtn.textContent = "再次点击删除";
      deleteTimer = window.setTimeout(disarmDelete, 3200);
      return;
    }

    disarmDelete();
    deleteClassBtn.disabled = true;
    editorStatus.textContent = "正在删除…";
    try {
      await api(`/api/admin/classes/${state.selectedId}`, { method: "DELETE" });
      history.replaceState({}, "", location.pathname);
      state.selectedId = null;
      await loadClasses();
      if (!state.classes.length) {
        resetForm();
      }
      showToast("班级已删除");
    } catch (error) {
      handleApiError(error);
      editorStatus.textContent = "删除失败";
    } finally {
      deleteClassBtn.disabled = false;
    }
  });

  (async () => {
    try {
      const data = await api("/api/auth/me");
      if (data.authenticated) {
        showAdmin();
        await loadClasses();
      } else {
        showLogin();
      }
    } catch (error) {
      showLogin(error.message || "无法连接后台服务。");
    }
  })();
})();
