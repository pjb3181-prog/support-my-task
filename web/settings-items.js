function $(id) { return document.getElementById(id); }

function parseItems() {
  const textarea = $("typeItemsInput");
  if (!textarea) return [];
  const seen = new Set();
  return String(textarea.value || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
}

function writeItems(items) {
  const textarea = $("typeItemsInput");
  if (!textarea) return;
  textarea.value = items.join("\n");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function renderEditor() {
  const list = $("typeItemList");
  if (!list) return;
  const items = parseItems();
  list.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "type-item-empty";
    empty.textContent = "준비항목이 없습니다. 아래에서 추가하세요.";
    list.appendChild(empty);
    return;
  }

  items.forEach((text, index) => {
    const row = document.createElement("div");
    row.className = "type-item-row";

    const input = document.createElement("input");
    input.className = "type-item-input";
    input.value = text;
    input.setAttribute("aria-label", `준비항목 ${index + 1}`);
    input.addEventListener("change", () => {
      const next = parseItems();
      const value = input.value.trim();
      if (!value) next.splice(index, 1);
      else next[index] = value;
      writeItems(next);
      renderEditor();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "type-item-remove secondary-button";
    remove.textContent = "삭제";
    remove.setAttribute("aria-label", `${text} 삭제`);
    remove.addEventListener("click", () => {
      const next = parseItems();
      next.splice(index, 1);
      writeItems(next);
      renderEditor();
    });

    row.append(input, remove);
    list.appendChild(row);
  });
}

function addItem() {
  const input = $("newTypeItemInput");
  if (!input) return;
  const value = input.value.trim();
  if (!value) return;
  const items = parseItems();
  if (!items.some((x) => x.toLowerCase() === value.toLowerCase())) items.push(value);
  writeItems(items);
  input.value = "";
  renderEditor();
  input.focus();
}

function init() {
  const textarea = $("typeItemsInput");
  const list = $("typeItemList");
  if (!textarea || !list) return;

  textarea.classList.add("type-items-source");
  renderEditor();

  $("addTypeItemButton")?.addEventListener("click", addItem);
  $("newTypeItemInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addItem();
    }
  });

  $("typeSelect")?.addEventListener("change", () => setTimeout(renderEditor, 0));
  $("settingsButton")?.addEventListener("click", () => setTimeout(renderEditor, 0));
  $("resetTypeItemsButton")?.addEventListener("click", () => setTimeout(renderEditor, 0));
  $("saveTypeItemsButton")?.addEventListener("click", () => setTimeout(renderEditor, 0));

  const observer = new MutationObserver(() => renderEditor());
  observer.observe(textarea, { attributes: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
