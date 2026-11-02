import { t } from "./i18n";
import type { FrameTarget } from "./types";

export interface TargetPickerOptions {
  emptyLabel: string;
  ariaLabel: string;
  getLabel: () => string;
  getSelectedId: () => string | null;
  getTargets: () => FrameTarget[];
  onApplySelection: () => void;
  onPick: (id: string) => void;
}

export interface TargetPickerController {
  root: HTMLDivElement;
  openPopover: () => void;
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

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "target-picker-apply";
  applyBtn.title = t("applyTargetFromSelection");
  applyBtn.setAttribute("aria-label", t("applyTargetFromSelection"));
  applyBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.25" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="7" r="1.25" fill="currentColor"/><path d="M7 0.75V2.5M7 11.5V13.25M0.75 7H2.5M11.5 7H13.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  const input = document.createElement("input");
  input.type = "text";
  input.className = "target-picker-input";
  input.placeholder = options.emptyLabel;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", options.ariaLabel);
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");

  const chevron = document.createElement("button");
  chevron.type = "button";
  chevron.className = "target-picker-chevron";
  chevron.tabIndex = -1;
  chevron.setAttribute("aria-label", options.ariaLabel);
  chevron.setAttribute("aria-expanded", "false");
  chevron.innerHTML =
    '<svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const control = document.createElement("div");
  control.className = "target-picker-control";
  control.append(applyBtn, input, chevron);

  const popover = document.createElement("div");
  popover.className = "target-picker-popover";
  popover.hidden = true;

  const list = document.createElement("ul");
  list.className = "target-picker-list";
  list.setAttribute("role", "listbox");

  popover.append(list);
  root.append(control, popover);

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
    if (open) {
      return;
    }
    const label = options.getLabel().trim();
    input.value = label;
    input.title = label || options.emptyLabel;
  }

  function renderList(): void {
    list.replaceChildren();
    const targets = filteredTargets();
    if (targets.length === 0) {
      const empty = document.createElement("li");
      empty.className = "target-picker-empty";
      empty.textContent =
        options.getTargets().length === 0
          ? t("targetNoCandidates")
          : t("targetNoMatch");
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
      opt.tabIndex = -1;
      opt.textContent = target.label;
      opt.title = target.label;
      if (target.id === selectedId) {
        opt.classList.add("is-selected");
      }
      if (index === activeIndex) {
        opt.classList.add("is-active");
        window.setTimeout(() => opt.scrollIntoView({ block: "nearest" }), 0);
      }
      opt.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      opt.addEventListener("click", () => {
        pick(target.id);
      });
      li.append(opt);
      list.append(li);
    });
  }

  function pick(id: string): void {
    options.onPick(id);
    closePopover();
    input.blur();
  }

  function openPopover(): void {
    if (input.disabled) {
      return;
    }
    if (!open) {
      closeAllTargetPopovers(controller);
      open = true;
      popover.hidden = false;
      input.setAttribute("aria-expanded", "true");
      chevron.setAttribute("aria-expanded", "true");
      filterQuery = "";
      const selectedIndex = options
        .getTargets()
        .findIndex((target) => target.id === options.getSelectedId());
      activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
      renderList();
    }
    if (document.activeElement !== input) {
      input.focus();
    }
    input.select();
  }

  function closePopover(): void {
    if (!open) {
      return;
    }
    open = false;
    popover.hidden = true;
    input.setAttribute("aria-expanded", "false");
    chevron.setAttribute("aria-expanded", "false");
    filterQuery = "";
    activeIndex = -1;
    refreshLabel();
  }

  const controller: TargetPickerController = {
    root,
    openPopover,
    closePopover,
    refresh: () => {
      refreshLabel();
      if (open) {
        renderList();
      }
    },
    setDisabled: (disabled: boolean) => {
      applyBtn.disabled = disabled;
      input.disabled = disabled;
      chevron.disabled = disabled;
      if (disabled) {
        closePopover();
      }
    },
    isOpen: () => open,
  };

  applyBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (applyBtn.disabled) {
      return;
    }
    closePopover();
    options.onApplySelection();
  });

  input.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  input.addEventListener("focus", () => {
    openPopover();
  });

  chevron.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  chevron.addEventListener("click", (event) => {
    event.stopPropagation();
    if (chevron.disabled) {
      return;
    }
    if (open) {
      closePopover();
      input.blur();
      return;
    }
    openPopover();
  });

  input.addEventListener("input", () => {
    if (!open) {
      openPopover();
    }
    filterQuery = input.value;
    activeIndex = 0;
    renderList();
  });

  input.addEventListener("keydown", (event) => {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      openPopover();
      return;
    }
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
      if (open && activeIndex >= 0 && targets[activeIndex]) {
        pick(targets[activeIndex].id);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closePopover();
      input.blur();
    }
  });

  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (document.activeElement !== input) {
        closePopover();
      }
    }, 0);
  });

  popover.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  pickers.add(controller);
  refreshLabel();
  return controller;
}

export function unregisterPicker(controller: TargetPickerController): void {
  pickers.delete(controller);
}
