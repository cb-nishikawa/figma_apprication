import type { FrameTarget, RecentFrame } from "./types";

export interface TargetPickerOptions {
  emptyLabel: string;
  ariaLabel: string;
  getLabel: () => string;
  getSelectedId: () => string | null;
  getTargets: () => FrameTarget[];
  /** 過去に選択した対象フレームの履歴（最大 20 件・直近が先頭）。 */
  getRecent: () => RecentFrame[];
  onApplySelection: () => void;
  onPick: (id: string) => void;
  /** 履歴項目が選ばれたとき（候補一覧の onPick と同じ扱い）。 */
  onPickRecent: (id: string) => void;
}

export interface TargetPickerController {
  root: HTMLDivElement;
  openPopover: () => void;
  /** 未選択時の「最近選択したフレーム」履歴ポップオーバーを開く。 */
  openHistoryPopover: () => void;
  closePopover: () => void;
  refresh: () => void;
  setDisabled: (disabled: boolean) => void;
  isOpen: () => boolean;
}

const pickers = new Set<TargetPickerController>();

export function closeAllTargetPopovers(
  except?: TargetPickerController | null
): void {
  for (const picker of pickers) {
    if (except && picker === except) {
      continue;
    }
    picker.closePopover();
  }
}

export function createTargetPicker(
  options: TargetPickerOptions
): TargetPickerController {
  const root = document.createElement("div");
  root.className = "target-picker";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "target-picker-btn is-empty";
  button.setAttribute("aria-label", options.ariaLabel);
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");

  const labelEl = document.createElement("span");
  labelEl.className = "target-picker-btn-label";
  button.append(labelEl);

  const popover = document.createElement("div");
  popover.className = "target-picker-popover";
  popover.hidden = true;

  const filter = document.createElement("input");
  filter.className = "target-picker-filter";
  filter.type = "text";
  filter.placeholder = "名前で検索";
  filter.autocomplete = "off";
  filter.spellcheck = false;

  const list = document.createElement("ul");
  list.className = "target-picker-list";
  list.setAttribute("role", "listbox");

  popover.append(filter, list);

  const history = document.createElement("div");
  history.className = "target-picker-history";
  history.hidden = true;
  history.setAttribute("role", "menu");

  const historyTitle = document.createElement("div");
  historyTitle.className = "exclude-title";
  historyTitle.textContent = "最近選択したフレーム";

  const historyList = document.createElement("ul");
  historyList.className = "target-picker-history-list";

  const historyFooter = document.createElement("button");
  historyFooter.type = "button";
  historyFooter.className = "target-picker-history-footer";
  historyFooter.textContent = "候補一覧から選ぶ…";

  history.append(historyTitle, historyList, historyFooter);
  root.append(button, popover, history);

  let filterQuery = "";
  let activeIndex = -1;
  let open = false;

  function filteredTargets(): FrameTarget[] {
    const query = filterQuery.trim().toLowerCase();
    const targets = options.getTargets();
    if (!query) {
      return targets;
    }
    return targets.filter(
      (t) =>
        t.label.toLowerCase().includes(query) ||
        t.name.toLowerCase().includes(query)
    );
  }

  function refreshLabel(): void {
    const label = options.getLabel().trim();
    if (label) {
      labelEl.textContent = label;
      button.classList.remove("is-empty");
      button.title = label;
    } else {
      labelEl.textContent = options.emptyLabel;
      button.classList.add("is-empty");
      button.title = options.emptyLabel;
    }
  }

  function renderList(): void {
    list.replaceChildren();
    const targets = filteredTargets();
    if (targets.length === 0) {
      const empty = document.createElement("li");
      empty.className = "target-picker-empty";
      empty.textContent =
        options.getTargets().length === 0 ? "候補がありません" : "該当なし";
      list.append(empty);
      activeIndex = -1;
      return;
    }
    if (activeIndex >= targets.length) {
      activeIndex = targets.length - 1;
    }
    const selectedId = options.getSelectedId();
    targets.forEach((target, index) => {
      const li = document.createElement("li");
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "target-picker-option";
      opt.setAttribute("role", "option");
      opt.textContent = target.label;
      opt.title = target.label;
      if (target.id === selectedId) {
        opt.classList.add("is-selected");
      }
      if (index === activeIndex) {
        opt.classList.add("is-active");
      }
      opt.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      opt.addEventListener("click", () => {
        options.onPick(target.id);
        controller.closePopover();
      });
      li.append(opt);
      list.append(li);
    });
  }

  function renderRecent(): void {
    historyList.replaceChildren();
    const recent = options.getRecent();
    if (recent.length === 0) {
      const empty = document.createElement("li");
      empty.className = "target-picker-empty";
      empty.textContent = "履歴はまだありません";
      historyList.append(empty);
      return;
    }
    const selectedId = options.getSelectedId();
    for (const entry of recent) {
      const li = document.createElement("li");
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "target-picker-history-item";
      opt.setAttribute("role", "menuitem");
      opt.textContent = entry.label;
      opt.title = entry.label;
      if (entry.id === selectedId) {
        opt.classList.add("is-selected");
      }
      opt.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      opt.addEventListener("click", () => {
        options.onPickRecent(entry.id);
        controller.closePopover();
      });
      li.append(opt);
      historyList.append(li);
    }
  }

  function openPopover(): void {
    closeAllTargetPopovers(controller);
    open = true;
    popover.hidden = false;
    history.hidden = true;
    button.setAttribute("aria-expanded", "true");
    filterQuery = "";
    filter.value = "";
    activeIndex = 0;
    renderList();
    window.setTimeout(() => filter.focus(), 0);
  }

  function openHistoryPopover(): void {
    closeAllTargetPopovers(controller);
    open = true;
    popover.hidden = true;
    history.hidden = false;
    button.setAttribute("aria-expanded", "true");
    renderRecent();
  }

  function closePopover(): void {
    if (!open) {
      return;
    }
    open = false;
    popover.hidden = true;
    history.hidden = true;
    button.setAttribute("aria-expanded", "false");
    filterQuery = "";
    filter.value = "";
    activeIndex = -1;
  }

  const controller: TargetPickerController = {
    root,
    openPopover,
    openHistoryPopover,
    closePopover,
    refresh: () => {
      refreshLabel();
      if (open) {
        renderList();
        renderRecent();
      }
    },
    setDisabled: (disabled: boolean) => {
      button.disabled = disabled;
      if (disabled) {
        closePopover();
      }
    },
    isOpen: () => open,
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (button.disabled) {
      return;
    }
    if (open) {
      closePopover();
      return;
    }
    options.onApplySelection();
  });

  filter.addEventListener("input", () => {
    filterQuery = filter.value;
    activeIndex = 0;
    renderList();
  });

  filter.addEventListener("keydown", (event) => {
    const targets = filteredTargets();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, targets.length - 1);
      if (activeIndex < 0 && targets.length > 0) {
        activeIndex = 0;
      }
      renderList();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      renderList();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && targets[activeIndex]) {
        options.onPick(targets[activeIndex].id);
        closePopover();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closePopover();
    }
  });

  popover.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  history.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  historyFooter.addEventListener("click", () => {
    openPopover();
  });

  history.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePopover();
    }
  });

  pickers.add(controller);
  refreshLabel();
  return controller;
}

export function unregisterPicker(controller: TargetPickerController): void {
  pickers.delete(controller);
}