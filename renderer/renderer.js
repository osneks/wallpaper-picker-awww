const grid = document.getElementById('grid');
const status = document.getElementById('status');
const folderPathEl = document.getElementById('folder-path');
const changeFolderBtn = document.getElementById('change-folder-btn');
const dropOverlay = document.getElementById('drop-overlay');
const filterBar = document.getElementById('filter-bar');

// wallpapersList: the full, unfiltered list exactly as returned by the
// backend. Its array index is the "real" index written to the state file
// and passed to apply-wallpaper.sh, so it must never be reordered/sliced.
let wallpapersList = [];
let currentIndex = -1;
let activeFilter = 'ALL'; // 'ALL' or a type string like 'PNG'
let focusedIndex = 0;
// cardEls: only the currently VISIBLE cards, in DOM order. Keyboard nav
// (arrow keys) walks this array. Each element carries its real wallpaper
// index in data-index, so filtering never desyncs which wallpaper Enter
// actually applies.
let cardEls = [];
let columns = 1;

async function init() {
  await refreshList();
  setupDragAndDrop();
}

async function refreshList() {
  const { wallpapers, currentIndex: idx, folder } = await window.electronAPI.listWallpapers();
  wallpapersList = wallpapers;
  folderPathEl.textContent = folder;
  folderPathEl.title = folder;
  currentIndex = idx;

  // If the folder changed and the active filter's type no longer exists,
  // fall back to showing everything instead of an empty grid.
  const availableTypes = new Set(wallpapersList.map((w) => w.type));
  if (activeFilter !== 'ALL' && !availableTypes.has(activeFilter)) {
    activeFilter = 'ALL';
  }

  renderFilterBar();
  render(wallpapersList);

  const startPos = currentIndex >= 0 ? cardEls.findIndex((c) => Number(c.dataset.index) === currentIndex) : -1;
  focusedIndex = startPos >= 0 ? startPos : 0;
  columns = computeColumns();
  updateFocusVisual();
}

function renderFilterBar() {
  const types = [...new Set(wallpapersList.map((w) => w.type))].sort();
  filterBar.innerHTML = '';

  if (types.length === 0) {
    filterBar.classList.add('hidden');
    return;
  }
  filterBar.classList.remove('hidden');

  const makeChip = (label, value, count) => {
    const chip = document.createElement('button');
    chip.className = 'filter-btn' + (activeFilter === value ? ' active' : '');
    chip.textContent = `${label} ${count}`;
    chip.addEventListener('click', () => {
      if (activeFilter === value) return;
      activeFilter = value;
      renderFilterBar();
      render(wallpapersList);
      focusedIndex = 0;
      columns = computeColumns();
      updateFocusVisual();
    });
    return chip;
  };

  filterBar.appendChild(makeChip('All', 'ALL', wallpapersList.length));
  for (const type of types) {
    const count = wallpapersList.filter((w) => w.type === type).length;
    filterBar.appendChild(makeChip(type, type, count));
  }
}

changeFolderBtn.addEventListener('click', async () => {
  const { changed, folder } = await window.electronAPI.chooseFolder();
  if (!changed) return;

  folderPathEl.textContent = folder;
  folderPathEl.title = folder;
  status.textContent = 'Loading…';

  await refreshList();
  status.textContent = '';
});

function render(wallpapers) {
  grid.innerHTML = '';
  grid.classList.remove('empty');
  cardEls = [];

  const visible = wallpapers
    .map((wp, realIndex) => ({ ...wp, realIndex }))
    .filter((wp) => activeFilter === 'ALL' || wp.type === activeFilter);

  if (visible.length === 0) {
    grid.classList.add('empty');
    grid.textContent =
      activeFilter === 'ALL' ? 'No wallpapers in this folder.' : `No ${activeFilter} wallpapers.`;
    return;
  }

  const fragment = document.createDocumentFragment();
  let lastType = null;
  let sectionGrid = null;

  visible.forEach((wp) => {
    const realIndex = wp.realIndex;

    if (wp.type !== lastType) {
      lastType = wp.type;
      const typeCount = visible.filter((w) => w.type === wp.type).length;

      const section = document.createElement('section');
      section.className = 'type-section';

      const heading = document.createElement('h2');
      heading.className = 'section-title';
      heading.innerHTML = `${wp.type} <span class="section-count">${typeCount}</span>`;
      section.appendChild(heading);

      sectionGrid = document.createElement('div');
      sectionGrid.className = 'section-grid';
      section.appendChild(sectionGrid);

      fragment.appendChild(section);
    }

    const card = document.createElement('div');
    card.className = 'card' + (realIndex === currentIndex ? ' selected' : '');
    card.tabIndex = -1;
    card.dataset.index = String(realIndex);

    const thumb = document.createElement('div');
    thumb.className = 'thumb';

    const img = document.createElement('img');
    img.src = `file://${wp.thumb || wp.path}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = wp.path;
    thumb.appendChild(img);

    // Three-Dots Menu Button
    const menuBtn = document.createElement('button');
    menuBtn.className = 'menu-btn';
    menuBtn.innerHTML = '⋮';
    menuBtn.title = 'More options';

    // Dropdown Action Menu
    const dropdown = document.createElement('div');
    dropdown.className = 'dropdown-menu hidden';
    dropdown.innerHTML = `
      <button class="dropdown-item" data-action="apply">Apply Wallpaper</button>
      <button class="dropdown-item" data-action="show">Show in File Manager</button>
      <button class="dropdown-item" data-action="copy">Copy Path</button>
      <div class="dropdown-divider"></div>
      <button class="dropdown-item danger" data-action="delete">Delete Wallpaper</button>
    `;

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllDropdowns();
      dropdown.classList.toggle('hidden');
    });

    dropdown.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = e.target.getAttribute('data-action');
      dropdown.classList.add('hidden');

      if (action === 'apply') {
        selectWallpaper(realIndex, wp.path, card);
      } else if (action === 'show') {
        await window.electronAPI.showInFolder(wp.path);
      } else if (action === 'copy') {
        await navigator.clipboard.writeText(wp.path);
        status.textContent = 'Path copied!';
        setTimeout(() => (status.textContent = ''), 1500);
      } else if (action === 'delete') {
        if (confirm(`Delete wallpaper from disk?\n\n${wp.path}`)) {
          status.textContent = 'Deleting…';
          const res = await window.electronAPI.deleteWallpaper(wp.path);
          if (res.ok) {
            status.textContent = 'Deleted';
            await refreshList();
          } else {
            status.textContent = `Error: ${res.error}`;
          }
          setTimeout(() => (status.textContent = ''), 1500);
        }
      }
    });

    // Render ONLY the file type tag (No File Name)
    const labelContainer = document.createElement('div');
    labelContainer.className = 'label-container';

    const typeBadge = document.createElement('span');
    const typeLower = wp.type.toLowerCase();
    typeBadge.className = `type-badge type-${typeLower}`;
    typeBadge.textContent = wp.type;

    labelContainer.appendChild(typeBadge);

    card.appendChild(thumb);
    card.appendChild(menuBtn);
    card.appendChild(dropdown);
    card.appendChild(labelContainer);

    card.addEventListener('click', () => {
      focusedIndex = cardEls.indexOf(card);
      updateFocusVisual();
      selectWallpaper(realIndex, wp.path, card);
    });

    sectionGrid.appendChild(card);
    cardEls.push(card);
  });

  grid.appendChild(fragment);
}

function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-menu').forEach((el) => el.classList.add('hidden'));
}

window.addEventListener('click', () => closeAllDropdowns());

function setupDragAndDrop() {
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropOverlay.classList.remove('hidden');
  });

  dropOverlay.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropOverlay.classList.add('hidden');
  });

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropOverlay.classList.add('hidden');

    const files = Array.from(e.dataTransfer.files).map((f) => f.path);
    if (files.length > 0) {
      status.textContent = 'Importing…';
      const res = await window.electronAPI.addWallpapers(files);
      if (res.ok && res.addedCount > 0) {
        status.textContent = `Imported ${res.addedCount} wallpaper(s)`;
        await refreshList();
      } else {
        status.textContent = 'No valid images dropped';
      }
      setTimeout(() => (status.textContent = ''), 2000);
    }
  });
}

// Reads the resolved column count straight from CSS Grid's computed style
// instead of guessing from card offsetTop. Measuring offsetTop breaks
// whenever the FIRST type-section has fewer cards than a full row (e.g. one
// stray GIF at the top) - it under-counts columns, which threw off
// ArrowUp/ArrowDown by jumping the wrong number of cards per row.
function computeColumns() {
  const firstSection = grid.querySelector('.section-grid');
  if (!firstSection) return 1;
  const trackCount = getComputedStyle(firstSection)
    .gridTemplateColumns.split(' ')
    .filter(Boolean).length;
  return trackCount || 1;
}

function updateFocusVisual() {
  cardEls.forEach((el, i) => el.classList.toggle('focused', i === focusedIndex));
  const el = cardEls[focusedIndex];
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function moveFocus(delta) {
  if (cardEls.length === 0) return;
  focusedIndex = Math.max(0, Math.min(cardEls.length - 1, focusedIndex + delta));
  updateFocusVisual();
}

window.addEventListener('keydown', (e) => {
  if (cardEls.length === 0) return;

  switch (e.key) {
    case 'ArrowRight':
      e.preventDefault();
      moveFocus(1);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      moveFocus(-1);
      break;
    case 'ArrowDown':
      e.preventDefault();
      moveFocus(columns);
      break;
    case 'ArrowUp':
      e.preventDefault();
      moveFocus(-columns);
      break;
    case 'Enter':
    case ' ': {
      e.preventDefault();
      const card = cardEls[focusedIndex];
      if (card) {
        const realIndex = Number(card.dataset.index);
        selectWallpaper(realIndex, wallpapersList[realIndex].path, card);
      }
      break;
    }
    default:
      return;
  }
});

window.addEventListener('resize', () => {
  columns = computeColumns();
});

async function selectWallpaper(index, targetPath, card) {
  document.querySelectorAll('.card.selected').forEach((el) => el.classList.remove('selected'));
  card.classList.add('selected');
  status.textContent = 'Applying…';

  try {
    await window.electronAPI.selectWallpaper(index, targetPath);
    currentIndex = index;
    status.textContent = 'Applied';
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }

  setTimeout(() => {
    status.textContent = '';
  }, 1500);
}

init();
