(function () {
  const { REGISTERS, LEGEND_ROWS, SECTIONS, COMMAND_MAP, NOTEBOOK_PRESET } = window.NecroData;
  const ALU = window.NecroALU;
  const Parser = window.NecroParser;

  const STORAGE_KEY = 'necro8080_state_v1';

  const DEFAULT_COLUMNS = [
    { key: 'num', label: '№ / Адрес' },
    { key: 'mnemonic', label: 'Мнемоника' },
    { key: 'content', label: 'Содержание' },
    { key: 'binary', label: 'Двоичный' },
    { key: 'hex', label: '16-рич.' }
  ];

  const appState = {
    signed: false,
    activeSectionId: 'sec1',
    activeSubId: 's1-13',
    searchQuery: '',
    startAddress: '75B6h',
    showAddresses: true,
    columnOrder: DEFAULT_COLUMNS.map(c => c.key),
    showColumnManager: false,
    rows: [],
    selectedRowIdx: 0,
    editingCell: null, // { rowIdx, field: 'mnemonic' | 'content' }
    kbTab: 'ops',
    kbNativeMode: false,
    simResult: null
  };

  // Элементы DOM
  const elCover = document.getElementById('cover-screen');
  const elCoverBtn = document.getElementById('cover-open-btn');
  const elRitual = document.getElementById('ritual-screen');
  const elBinaryPrayer = document.getElementById('binary-prayer');
  const elBloodSeal = document.getElementById('blood-seal-btn');
  const elRitualStatus = document.getElementById('ritual-status');
  const elGrimoire = document.getElementById('grimoire-app');
  const elTopTabs = document.getElementById('top-tabs');
  const elRightTabs = document.getElementById('right-tabs');
  const elPageScroll = document.getElementById('page-scroll');
  const elContent = document.getElementById('section-content');
  const elSearchBar = document.getElementById('search-bar');
  const elSearchInput = document.getElementById('search-input');
  const elDetailModal = document.getElementById('detail-modal');
  const elDetailTitle = document.getElementById('detail-title');
  const elDetailLore = document.getElementById('detail-lore-tag');
  const elDetailBody = document.getElementById('detail-body');
  const elKeyboard = document.getElementById('runic-keyboard');
  const elKbTarget = document.getElementById('kb-target-label');
  const elKbPreview = document.getElementById('kb-preview-text');
  const elKbStatus = document.getElementById('kb-status');
  const elKbTabs = document.getElementById('kb-tabs');
  const elKbBody = document.getElementById('kb-body');
  const elKbModeBtn = document.getElementById('kb-mode-switch');

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved) {
        appState.signed = !!saved.signed;
        if (saved.activeSectionId) appState.activeSectionId = saved.activeSectionId;
        if (saved.startAddress) appState.startAddress = saved.startAddress;
        if (typeof saved.showAddresses === 'boolean') appState.showAddresses = saved.showAddresses;
        if (Array.isArray(saved.columnOrder) && saved.columnOrder.length === DEFAULT_COLUMNS.length) {
          appState.columnOrder = saved.columnOrder;
        }
        if (Array.isArray(saved.rows) && saved.rows.length > 0) {
          appState.rows = saved.rows;
        }
      }
    } catch (e) { /* игнор */ }

    if (appState.rows.length === 0) {
      loadPresetRows(false);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        signed: appState.signed,
        activeSectionId: appState.activeSectionId,
        startAddress: appState.startAddress,
        showAddresses: appState.showAddresses,
        columnOrder: appState.columnOrder,
        rows: appState.rows
      }));
    } catch (e) { /* игнор */ }
  }

  function encodeAsciiPrayer(text) {
    return Array.from(text)
      .map(ch => ch.charCodeAt(0).toString(2).padStart(8, '0'))
      .join(' ');
  }

  function playBloodChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(55, now + 0.55);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.68);
    } catch (e) { /* звук опционален */ }
  }

  // ==================== ОБЛОЖКА И МОЛИТВА ====================
  function initRitualAndCover() {
    elBinaryPrayer.textContent = encodeAsciiPrayer('AVE MECHA-COGITATOR! RUNAE POTENTIAE. SANGUINE SIGNATUM.');

    function openCoverToRitual() {
      elCover.classList.add('opening');
      setTimeout(() => elCover.classList.add('hidden'), 780);
    }

    elCoverBtn.addEventListener('click', openCoverToRitual);
    document.getElementById('btn-view-cover').addEventListener('click', () => {
      elCover.classList.remove('hidden', 'opening');
    });

    if (appState.signed) {
      elCover.classList.add('hidden');
      elRitual.classList.add('hidden');
      elGrimoire.classList.remove('hidden');
    } else {
      // При первом запуске обложка плавно раскрывается к первой странице молитвы
      setTimeout(() => {
        if (!elCover.classList.contains('opening')) {
          openCoverToRitual();
        }
      }, 950);
    }

    elBloodSeal.addEventListener('click', () => {
      if (elBloodSeal.classList.contains('signed')) return;
      elBloodSeal.classList.add('signed');
      playBloodChime();
      elRitualStatus.innerHTML = '🩸 <strong>ПЕЧАТЬ КРОВИ ПРИНЯТА · ВРАТА ОТКРЫТЫ</strong>';
      appState.signed = true;
      saveState();
      setTimeout(() => {
        elRitual.classList.add('hidden');
        elGrimoire.classList.remove('hidden');
        renderApp();
      }, 1250);
    });

    document.getElementById('btn-show-prayer').addEventListener('click', () => {
      closeKeyboard();
      elBloodSeal.classList.remove('signed');
      elRitualStatus.innerHTML = '<span class="pulse-blood">🩸 Нажмите, чтобы расписаться кровью</span>';
      elGrimoire.classList.add('hidden');
      elRitual.classList.remove('hidden');
    });
  }

  // ==================== ПОИСК И НАВИГАЦИЯ ====================
  function initTopControls() {
    const btnSearch = document.getElementById('btn-search-toggle');
    const btnClear = document.getElementById('search-clear');

    btnSearch.addEventListener('click', () => {
      elSearchBar.classList.toggle('hidden');
      if (!elSearchBar.classList.contains('hidden')) {
        elSearchInput.focus();
      } else {
        appState.searchQuery = '';
        elSearchInput.value = '';
        renderMainContent();
      }
    });

    elSearchInput.addEventListener('input', e => {
      appState.searchQuery = e.target.value.trim().toLowerCase();
      renderMainContent();
    });

    btnClear.addEventListener('click', () => {
      appState.searchQuery = '';
      elSearchInput.value = '';
      elSearchBar.classList.add('hidden');
      renderMainContent();
    });

    document.getElementById('detail-close').addEventListener('click', closeDetailModal);
    elDetailModal.querySelector('.detail-backdrop').addEventListener('click', closeDetailModal);
  }

  function renderTopTabs() {
    elTopTabs.innerHTML = '';
    SECTIONS.forEach(sec => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'top-tab' + (sec.id === appState.activeSectionId ? ' active' : '');
      btn.innerHTML = `<span class="tab-roman">${sec.roman}</span><span class="tab-name">${sec.shortTitle}</span>`;
      btn.addEventListener('click', () => {
        if (sec.id !== 'calc_table') closeKeyboard();
        appState.activeSectionId = sec.id;
        appState.activeSubId = sec.subsections[0].id;
        appState.searchQuery = '';
        elSearchInput.value = '';
        elSearchBar.classList.add('hidden');
        saveState();
        renderApp();
        elPageScroll.scrollTop = 0;
      });
      elTopTabs.appendChild(btn);
    });
  }

  function renderRightTabs() {
    elRightTabs.innerHTML = '';
    const sec = SECTIONS.find(s => s.id === appState.activeSectionId) || SECTIONS[0];
    sec.subsections.forEach(sub => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'right-tab' + (sub.id === appState.activeSubId ? ' active' : '');
      btn.textContent = sub.tabLabel;
      btn.addEventListener('click', () => {
        appState.activeSubId = sub.id;
        renderRightTabs();
        if (sec.id === 'calc_table' && sub.id === 'calc-sim') {
          runProgramSimulation();
          return;
        }
        const target = document.getElementById(sub.id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      elRightTabs.appendChild(btn);
    });
  }

  function renderFlagPills(flags) {
    const names = ['Tz', 'Ts', 'Tc', 'Tv', 'Tp'];
    return `<div class="flag-strip">${flags.map((f, i) => {
      const cls = f === '+' ? 'mod' : f === '0' ? 'zero' : f === '1' ? 'one' : '';
      return `<span class="flag-pill ${cls}" title="${names[i]}">${f}</span>`;
    }).join('')}</div>`;
  }

  function renderMainContent() {
    if (appState.searchQuery) {
      renderSearchResults();
      return;
    }

    const sec = SECTIONS.find(s => s.id === appState.activeSectionId) || SECTIONS[0];
    if (sec.id === 'legend') {
      renderLegendSection(sec);
    } else if (sec.id === 'calc_table') {
      renderCalculationSection(sec);
    } else {
      renderCommandsSection(sec);
    }
  }

  function renderLegendSection(sec) {
    elContent.innerHTML = `
      <div class="section-banner">
        <h2>${sec.title}</h2>
        <p>${sec.lore}</p>
      </div>
      <div id="legend-main" class="subsec-card">
        <table class="legend-table">
          <thead>
            <tr><th>Обозначение</th><th>Содержание в свитке</th></tr>
          </thead>
          <tbody>
            ${LEGEND_ROWS.map(r => `
              <tr>
                <td class="legend-sym">${r.sym}</td>
                <td>${r.desc}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderCommandsSection(sec) {
    let html = `
      <div class="section-banner">
        <h2>${sec.title}</h2>
        <p>${sec.lore} · Нажмите на любую руну для вызова алтаря расчёта</p>
      </div>
    `;

    sec.subsections.forEach(sub => {
      html += `
        <div id="${sub.id}" class="subsec-card">
          <div class="subsec-header">
            <span>${sub.title}</span>
            <span class="subsec-mask">${sub.maskHeader || ''}</span>
          </div>
          <div class="ref-col-legend">
            <span>Мнемоника · Код · Б/Ц/Т</span>
            <span>Tz Ts Tc Tv Tp</span>
          </div>
          <div class="cmd-list">
            ${sub.commands.map(cmd => `
              <button type="button" class="cmd-row" data-cmd-id="${cmd.id}">
                <div class="cmd-row-top">
                  <div class="cmd-mnem-wrap">
                    <span class="cmd-mnem">${cmd.mnem}</span>
                    <span class="cmd-code-mask">${cmd.codeMask}</span>
                  </div>
                  <span class="cmd-timing">${cmd.bct}</span>
                </div>
                <div class="cmd-row-bottom">
                  <div class="cmd-op">
                    ${cmd.op}
                    <span class="cmd-op-note">${cmd.opNote || ''}</span>
                  </div>
                  ${renderFlagPills(cmd.flags)}
                </div>
              </button>
            `).join('')}
          </div>
        </div>
      `;
    });

    elContent.innerHTML = html;
    elContent.querySelectorAll('.cmd-row').forEach(btn => {
      btn.addEventListener('click', () => openCommandDetail(btn.dataset.cmdId));
    });
  }

  function renderSearchResults() {
    const q = appState.searchQuery;
    const matches = Object.values(COMMAND_MAP).filter(cmd =>
      cmd.mnem.toLowerCase().includes(q) ||
      cmd.op.toLowerCase().includes(q) ||
      (cmd.opNote && cmd.opNote.toLowerCase().includes(q)) ||
      cmd.codeMask.toLowerCase().includes(q) ||
      cmd.loreName.toLowerCase().includes(q)
    );

    elContent.innerHTML = `
      <div class="section-banner">
        <h2>Поиск по гримуару: «${escapeHtml(q)}»</h2>
        <p>Найдено рун: ${matches.length}</p>
      </div>
      <div class="cmd-list" style="border-top:1px solid #8a6d43;border-radius:4px;">
        ${matches.length === 0
          ? '<div style="padding:14px;text-align:center;font-style:italic;">В скрижалях нет такой руны...</div>'
          : matches.map(cmd => `
            <button type="button" class="cmd-row" data-cmd-id="${cmd.id}">
              <div class="cmd-row-top">
                <div class="cmd-mnem-wrap">
                  <span class="cmd-mnem">${cmd.mnem}</span>
                  <span class="cmd-code-mask">${cmd.codeMask}</span>
                </div>
                <span class="cmd-timing">${cmd.bct}</span>
              </div>
              <div class="cmd-row-bottom">
                <div class="cmd-op">${cmd.op}<span class="cmd-op-note">${cmd.opNote || ''}</span></div>
                ${renderFlagPills(cmd.flags)}
              </div>
            </button>
          `).join('')}
      </div>
    `;
    elContent.querySelectorAll('.cmd-row').forEach(btn => {
      btn.addEventListener('click', () => openCommandDetail(btn.dataset.cmdId));
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ==================== МОДАЛЬНОЕ ОКНО ДЕТАЛЕЙ + КАЛЬКУЛЯТОР ====================
  function openCommandDetail(cmdId) {
    const cmd = COMMAND_MAP[cmdId];
    if (!cmd) return;
    closeKeyboard();
    elDetailLore.textContent = `${cmd.loreName} · ${cmd.codeMask} · ${cmd.bct}`;
    elDetailTitle.textContent = `${cmd.mnem} — ${cmd.op}`;

    elDetailBody.innerHTML = `
      <div class="detail-card">
        <h3>📜 Принцип действия</h3>
        <p>${cmd.principle}</p>
        <p style="font-family:var(--font-mono);font-size:11px;color:var(--ink-crimson);">
          Признаки (Tz Ts Tc Tv Tp): ${cmd.flags.join(' ')}
        </p>
      </div>

      <div class="detail-card">
        <h3>🕯 Пример использования и пошаговый разбор</h3>
        <pre class="code-scroll-box">${escapeHtml(cmd.exampleCode)}</pre>
        <ol class="step-trace-list">
          ${cmd.exampleSteps.map(st => `<li>${escapeHtml(st)}</li>`).join('')}
        </ol>
      </div>

      <div class="detail-card">
        <h3>⚗ Алтарь Интерактивного Расчёта</h3>
        <div id="detail-calc-controls" class="calc-controls-grid"></div>
        <div id="detail-calc-output" class="calc-output-box"></div>
        <button id="detail-add-table-btn" type="button" class="add-to-table-btn">
          ＋ Внести эту команду в Таблицу Калькуляции
        </button>
      </div>
    `;

    elDetailModal.classList.remove('hidden');
    setupCommandCalculator(cmd);
  }

  function closeDetailModal() {
    elDetailModal.classList.add('hidden');
  }

  function setupCommandCalculator(cmd) {
    const controlsEl = document.getElementById('detail-calc-controls');
    const outputEl = document.getElementById('detail-calc-output');
    const addBtn = document.getElementById('detail-add-table-btn');

    const regOpts = REGISTERS.map(r => `<option value="${r.name}">${r.name} (${r.code})</option>`).join('');
    const movOpts = REGISTERS.map(r => `<option value="${r.name}">${r.name}</option>`).join('');
    const pairOpts = `<option value="B">BC (B/C)</option><option value="D">DE (D/E)</option><option value="H">HL (H/L)</option><option value="SP">SP</option>`;
    const stackOpts = `<option value="B">BC</option><option value="D">DE</option><option value="H">HL</option>`;

    let fieldsHtml = '';
    const t = cmd.calcType;

    if (t === 'mov') {
      fieldsHtml += `
        <div class="calc-field"><label>Приёмник rᵢ</label><select id="c-ri">${movOpts}</select></div>
        <div class="calc-field"><label>Источник rⱼ</label><select id="c-rj">${movOpts}</select></div>
        <div class="calc-field"><label>Исх. (rⱼ) hex</label><input id="c-v2" value="25h"></div>
      `;
    } else if (t === 'mvi') {
      fieldsHtml += `
        <div class="calc-field"><label>Регистр rᵢ</label><select id="c-ri">${regOpts}</select></div>
        <div class="calc-field"><label>Байт &lt;B₂&gt; hex</label><input id="c-b2" value="43h"></div>
      `;
    } else if (t === 'lxi') {
      fieldsHtml += `
        <div class="calc-field"><label>Пара</label><select id="c-rp">${pairOpts}</select></div>
        <div class="calc-field"><label>Слово &lt;B₃B₂&gt;</label><input id="c-word" value="75B6h"></div>
      `;
    } else if (t === 'stax' || t === 'ldax') {
      fieldsHtml += `
        <div class="calc-field"><label>Значение A</label><input id="c-a" value="5Ah"></div>
        <div class="calc-field"><label>Ячейка [(${cmd.fixedPair})]</label><input id="c-mem" value="3Ch"></div>
      `;
    } else if (t === 'addr16_hl_store' || t === 'addr16_hl_load' || t === 'sta' || t === 'lda') {
      fieldsHtml += `
        <div class="calc-field"><label>Адрес &lt;B₃B₂&gt;</label><input id="c-word" value="4000h"></div>
        <div class="calc-field"><label>${t.includes('hl') ? 'HL (hex)' : 'A / [addr]'}</label><input id="c-v1" value="${t.includes('hl') ? '1234h' : '7Fh'}"></div>
      `;
    } else if (t === 'push' || t === 'pop') {
      fieldsHtml += `
        <div class="calc-field"><label>Пара</label><select id="c-rp">${stackOpts}</select></div>
        <div class="calc-field"><label>Исх. SP</label><input id="c-sp" value="2000h"></div>
        <div class="calc-field"><label>Данные пары</label><input id="c-word" value="1234h"></div>
      `;
    } else if (t === 'push_psw' || t === 'pop_psw') {
      fieldsHtml += `
        <div class="calc-field"><label>Исх. SP</label><input id="c-sp" value="2000h"></div>
        <div class="calc-field"><label>A (hex)</label><input id="c-a" value="43h"></div>
        <div class="calc-field"><label>F (PSW hex)</label><input id="c-f" value="46h"></div>
      `;
    } else if (t === 'xchg') {
      fieldsHtml += `
        <div class="calc-field"><label>Исх. DE</label><input id="c-de" value="1122h"></div>
        <div class="calc-field"><label>Исх. HL</label><input id="c-hl" value="3344h"></div>
      `;
    } else if (t === 'xthl') {
      fieldsHtml += `
        <div class="calc-field"><label>Исх. HL</label><input id="c-hl" value="1234h"></div>
        <div class="calc-field"><label>[SP] / [SP+1]</label><input id="c-stk" value="ABCDh"></div>
      `;
    } else if (t === 'sphl' || t === 'pchl') {
      fieldsHtml += `<div class="calc-field"><label>Исх. HL</label><input id="c-hl" value="7600h"></div>`;
    } else if (t === 'inr' || t === 'dcr') {
      fieldsHtml += `
        <div class="calc-field"><label>Регистр rᵢ</label><select id="c-ri">${regOpts}</select></div>
        <div class="calc-field"><label>Исх. (rᵢ) hex</label><input id="c-v1" value="${t === 'inr' ? 'FFh' : '01h'}"></div>
        <div class="calc-field"><label>Вход. Tc</label><select id="c-tc"><option value="0">0</option><option value="1">1</option></select></div>
      `;
    } else if (t === 'inx' || t === 'dcx') {
      fieldsHtml += `
        <div class="calc-field"><label>Пара</label><select id="c-rp">${pairOpts}</select></div>
        <div class="calc-field"><label>Исх. значение</label><input id="c-word" value="75FFh"></div>
      `;
    } else if (t === 'dad') {
      fieldsHtml += `
        <div class="calc-field"><label>Пара</label><select id="c-rp">${pairOpts}</select></div>
        <div class="calc-field"><label>Исх. HL</label><input id="c-hl" value="8000h"></div>
        <div class="calc-field"><label>Исх. пара</label><input id="c-word" value="9000h"></div>
      `;
    } else if (t === 'alu_reg') {
      fieldsHtml += `
        <div class="calc-field"><label>Регистр rᵢ</label><select id="c-ri">${regOpts}</select></div>
        <div class="calc-field"><label>Исх. A (hex)</label><input id="c-a" value="43h"></div>
        <div class="calc-field"><label>Исх. (rᵢ) hex</label><input id="c-v2" value="25h"></div>
        <div class="calc-field"><label>Вход. Tc</label><select id="c-tc"><option value="0">0</option><option value="1">1</option></select></div>
      `;
    } else if (t === 'alu_imm') {
      fieldsHtml += `
        <div class="calc-field"><label>Исх. A (hex)</label><input id="c-a" value="25h"></div>
        <div class="calc-field"><label>Операнд &lt;B₂&gt;</label><input id="c-b2" value="25h"></div>
        <div class="calc-field"><label>Вход. Tc</label><select id="c-tc"><option value="0">0</option><option value="1">1</option></select></div>
      `;
    } else if (t === 'rotate') {
      fieldsHtml += `
        <div class="calc-field"><label>Исх. A (hex)</label><input id="c-a" value="85h"></div>
        <div class="calc-field"><label>Вход. Tc</label><select id="c-tc"><option value="0">0</option><option value="1">1</option></select></div>
      `;
    } else if (t === 'jump' || t === 'call') {
      fieldsHtml += `
        <div class="calc-field"><label>Адрес &lt;B₃B₂&gt;</label><input id="c-word" value="7600h"></div>
        <div class="calc-field"><label>Тек. PC</label><input id="c-pc" value="75B8h"></div>
        ${cmd.cond ? `<div class="calc-field"><label>Флаг ${cmd.cond.flag}</label><select id="c-condf"><option value="0">0</option><option value="1">1</option></select></div>` : ''}
        ${t === 'call' ? `<div class="calc-field"><label>Тек. SP</label><input id="c-sp" value="2000h"></div>` : ''}
      `;
    } else if (t === 'ret') {
      fieldsHtml += `
        <div class="calc-field"><label>Тек. SP</label><input id="c-sp" value="1FFEh"></div>
        <div class="calc-field"><label>Адрес в стеке</label><input id="c-word" value="75C0h"></div>
        ${cmd.cond ? `<div class="calc-field"><label>Флаг ${cmd.cond.flag}</label><select id="c-condf"><option value="0">0</option><option value="1">1</option></select></div>` : ''}
      `;
    } else if (t === 'io_in' || t === 'io_out') {
      fieldsHtml += `
        <div class="calc-field"><label>Порт &lt;B₂&gt;</label><input id="c-b2" value="01h"></div>
        <div class="calc-field"><label>${t === 'io_in' ? 'Байт в порту' : 'Исх. A'}</label><input id="c-a" value="55h"></div>
      `;
    } else if (t === 'rst') {
      fieldsHtml += `
        <div class="calc-field"><label>Вектор AAA (0..7)</label><select id="c-rst">${[0,1,2,3,4,5,6,7].map(n => `<option value="${n}">${n} (${ALU.hex4(n*8)})</option>`).join('')}</select></div>
        <div class="calc-field"><label>Тек. PC</label><input id="c-pc" value="75B6h"></div>
        <div class="calc-field"><label>Тек. SP</label><input id="c-sp" value="2000h"></div>
      `;
    } else if (t === 'cma' || t === 'daa') {
      fieldsHtml += `
        <div class="calc-field"><label>Исх. A (hex)</label><input id="c-a" value="${t === 'cma' ? '43h' : '1Eh'}"></div>
        <div class="calc-field"><label>Вход. Tc</label><select id="c-tc"><option value="0">0</option><option value="1">1</option></select></div>
        <div class="calc-field"><label>Вход. Tv</label><select id="c-tv"><option value="0">0</option><option value="1">1</option></select></div>
      `;
    } else if (t === 'stc' || t === 'cmc') {
      fieldsHtml += `<div class="calc-field"><label>Вход. Tc</label><select id="c-tc"><option value="0">0</option><option value="1">1</option></select></div>`;
    }

    controlsEl.innerHTML = fieldsHtml;

    if (t === 'mov') {
      controlsEl.querySelector('#c-ri').value = 'A';
      controlsEl.querySelector('#c-rj').value = 'C';
    }
    if (t === 'alu_reg' && cmd.aluOp === 'ORA') {
      controlsEl.querySelector('#c-ri').value = 'C';
      controlsEl.querySelector('#c-a').value = 'BCh';
      controlsEl.querySelector('#c-v2').value = '00h';
    }

    let lastParsed = null;

    function recompute() {
      const valOf = (id, def) => {
        const el = controlsEl.querySelector('#' + id);
        return el ? el.value : def;
      };
      const byteOf = (id, def) => {
        const p = Parser.parseNumber(valOf(id, ''), 8);
        return p === null ? def : p;
      };
      const wordOf = (id, def) => {
        const p = Parser.parseNumber(valOf(id, ''), 16);
        return p === null ? def : p;
      };

      const flags = { Tz: 0, Ts: 0, Tc: parseInt(valOf('c-tc', '0'), 10) || 0, Tv: parseInt(valOf('c-tv', '0'), 10) || 0, Tp: 0 };
      const touched = { Tz: false, Ts: false, Tc: false, Tv: false, Tp: false };
      let mnemStr = cmd.mnem;
      let resultDesc = '—';

      if (t === 'mov') {
        const ri = valOf('c-ri', 'A'), rj = valOf('c-rj', 'C'), v2 = byteOf('c-v2', 0);
        if (ri === 'M' && rj === 'M') {
          mnemStr = 'HLT';
          resultDesc = 'M, M даёт код 76h (Останов HLT)';
        } else {
          mnemStr = `MOV ${ri}, ${rj}`;
          resultDesc = `${ri} = ${ALU.hex2(v2)} (${ALU.bin8(v2)}₂)`;
        }
      } else if (t === 'mvi') {
        const ri = valOf('c-ri', 'B'), b2 = byteOf('c-b2', 0);
        mnemStr = `MVI ${ri}, ${ALU.hex2(b2)}`;
        resultDesc = `${ri} = ${ALU.hex2(b2)} (${ALU.bin8(b2)}₂)`;
      } else if (t === 'lxi') {
        const rp = valOf('c-rp', 'H'), w = wordOf('c-word', 0);
        mnemStr = `LXI ${rp}, ${ALU.hex4(w)}`;
        resultDesc = `${rp === 'SP' ? 'SP' : rp === 'B' ? 'BC' : rp === 'D' ? 'DE' : 'HL'} = ${ALU.hex4(w)}`;
      } else if (t === 'stax') {
        const a = byteOf('c-a', 0);
        mnemStr = `STAX ${cmd.fixedPair[0]}`;
        resultDesc = `[(${cmd.fixedPair})] = ${ALU.hex2(a)}`;
      } else if (t === 'ldax') {
        const m = byteOf('c-mem', 0);
        mnemStr = `LDAX ${cmd.fixedPair[0]}`;
        resultDesc = `A = ${ALU.hex2(m)} (${ALU.bin8(m)}₂)`;
      } else if (t === 'addr16_hl_store' || t === 'addr16_hl_load' || t === 'sta' || t === 'lda') {
        const w = wordOf('c-word', 0);
        const v1 = wordOf('c-v1', 0);
        mnemStr = `${cmd.mnem} ${ALU.hex4(w)}`;
        if (t === 'addr16_hl_store') resultDesc = `[${ALU.hex4(w)}]=${ALU.hex2(v1 & 0xff)}, [${ALU.hex4(w + 1)}]=${ALU.hex2(v1 >> 8)}`;
        else if (t === 'addr16_hl_load') resultDesc = `HL = ${ALU.hex4(v1)}`;
        else if (t === 'sta') resultDesc = `[${ALU.hex4(w)}] = ${ALU.hex2(v1 & 0xff)}`;
        else resultDesc = `A = ${ALU.hex2(v1 & 0xff)}`;
      } else if (t === 'push' || t === 'pop') {
        const rp = valOf('c-rp', 'B'), sp = wordOf('c-sp', 0x2000), w = wordOf('c-word', 0);
        mnemStr = `${cmd.mnem} ${rp}`;
        if (t === 'push') resultDesc = `SP=${ALU.hex4(sp - 2)}, стек=[${ALU.hex4(w)}]`;
        else resultDesc = `Пара=${ALU.hex4(w)}, SP=${ALU.hex4(sp + 2)}`;
      } else if (t === 'push_psw' || t === 'pop_psw') {
        const sp = wordOf('c-sp', 0x2000), a = byteOf('c-a', 0), fByte = byteOf('c-f', 0);
        mnemStr = cmd.id === 'PUSH_PSW' ? 'PUSH PSW' : 'POP PSW';
        if (t === 'push_psw') {
          resultDesc = `[SP-1]=${ALU.hex2(a)}, [SP-2]=${ALU.hex2(fByte)}, SP=${ALU.hex4(sp - 2)}`;
        } else {
          Object.assign(flags, ALU.unpackPSW(fByte));
          touched.Tz = touched.Ts = touched.Tc = touched.Tv = touched.Tp = true;
          resultDesc = `A=${ALU.hex2(a)}, F=${ALU.hex2(fByte)}, SP=${ALU.hex4(sp + 2)}`;
        }
      } else if (t === 'xchg') {
        const de = wordOf('c-de', 0), hl = wordOf('c-hl', 0);
        mnemStr = 'XCH';
        resultDesc = `DE=${ALU.hex4(hl)}, HL=${ALU.hex4(de)}`;
      } else if (t === 'xthl') {
        const hl = wordOf('c-hl', 0), stk = wordOf('c-stk', 0);
        mnemStr = 'XTH';
        resultDesc = `HL=${ALU.hex4(stk)}, стек=${ALU.hex4(hl)}`;
      } else if (t === 'sphl' || t === 'pchl') {
        const hl = wordOf('c-hl', 0);
        mnemStr = cmd.mnem;
        resultDesc = `${t === 'sphl' ? 'SP' : 'PC'} = ${ALU.hex4(hl)}`;
      } else if (t === 'inr' || t === 'dcr') {
        const ri = valOf('c-ri', 'B'), v1 = byteOf('c-v1', 0);
        mnemStr = `${cmd.mnem} ${ri}`;
        const res = t === 'inr' ? ALU.aluInr(v1, flags) : ALU.aluDcr(v1, flags);
        touched.Tz = touched.Ts = touched.Tv = touched.Tp = true;
        resultDesc = `${ri} = ${ALU.hex2(res)} (${ALU.bin8(res)}₂)`;
      } else if (t === 'inx' || t === 'dcx') {
        const rp = valOf('c-rp', 'H'), w = wordOf('c-word', 0);
        mnemStr = `${cmd.mnem} ${rp}`;
        const res = (t === 'inx' ? w + 1 : w - 1) & 0xffff;
        resultDesc = `${rp === 'SP' ? 'SP' : rp} = ${ALU.hex4(res)}`;
      } else if (t === 'dad') {
        const rp = valOf('c-rp', 'D'), hl = wordOf('c-hl', 0), w = wordOf('c-word', 0);
        mnemStr = `DAD ${rp}`;
        const sum = hl + w;
        flags.Tc = sum > 0xffff ? 1 : 0;
        touched.Tc = true;
        resultDesc = `HL = ${ALU.hex4(sum & 0xffff)}`;
      } else if (t === 'alu_reg') {
        const ri = valOf('c-ri', 'B'), a = byteOf('c-a', 0), v2 = byteOf('c-v2', 0);
        const opName = cmd.aluOp;
        mnemStr = `${opName} ${ri}`;
        let res = a;
        if (opName === 'ADD') res = ALU.aluAdd(a, v2, 0, flags);
        else if (opName === 'ADC') res = ALU.aluAdd(a, v2, flags.Tc, flags);
        else if (opName === 'SUB') res = ALU.aluSub(a, v2, 0, flags);
        else if (opName === 'SBB') res = ALU.aluSub(a, v2, flags.Tc, flags);
        else if (opName === 'ANA') res = ALU.aluLogic('AND', a, v2, flags);
        else if (opName === 'XRA') res = ALU.aluLogic('XOR', a, v2, flags);
        else if (opName === 'ORA') res = ALU.aluLogic('OR', a, v2, flags);
        else if (opName === 'CMP') ALU.aluSub(a, v2, 0, flags);
        touched.Tz = touched.Ts = touched.Tc = touched.Tv = touched.Tp = true;
        resultDesc = opName === 'CMP'
          ? `A без изм. (${ALU.hex2(a)}), разность ${ALU.hex2((a - v2) & 0xff)}`
          : `A = ${ALU.hex2(res)} (${ALU.bin8(res)}₂)`;
      } else if (t === 'alu_imm') {
        const a = byteOf('c-a', 0), b2 = byteOf('c-b2', 0);
        const opName = cmd.aluOp;
        mnemStr = `${opName} ${ALU.hex2(b2)}`;
        let res = a;
        if (opName === 'ADI') res = ALU.aluAdd(a, b2, 0, flags);
        else if (opName === 'ACI') res = ALU.aluAdd(a, b2, flags.Tc, flags);
        else if (opName === 'SUI') res = ALU.aluSub(a, b2, 0, flags);
        else if (opName === 'SBI') res = ALU.aluSub(a, b2, flags.Tc, flags);
        else if (opName === 'ANI') res = ALU.aluLogic('AND', a, b2, flags);
        else if (opName === 'XRI') res = ALU.aluLogic('XOR', a, b2, flags);
        else if (opName === 'ORI') res = ALU.aluLogic('OR', a, b2, flags);
        else if (opName === 'CPI') ALU.aluSub(a, b2, 0, flags);
        touched.Tz = touched.Ts = touched.Tc = touched.Tv = touched.Tp = true;
        resultDesc = opName === 'CPI'
          ? `A без изм. (${ALU.hex2(a)}), разность ${ALU.hex2((a - b2) & 0xff)}`
          : `A = ${ALU.hex2(res)} (${ALU.bin8(res)}₂)`;
      } else if (t === 'rotate') {
        const a = byteOf('c-a', 0);
        mnemStr = cmd.rotOp;
        const res = ALU.aluRotate(cmd.rotOp, a, flags);
        touched.Tc = true;
        resultDesc = `A = ${ALU.hex2(res)} (${ALU.bin8(res)}₂)`;
      } else if (t === 'jump' || t === 'call') {
        const w = wordOf('c-word', 0), pc = wordOf('c-pc', 0x75b8), sp = wordOf('c-sp', 0x2000);
        const condVal = parseInt(valOf('c-condf', '0'), 10);
        if (cmd.cond) flags[cmd.cond.flag] = condVal;
        mnemStr = `${cmd.mnem} ${ALU.hex4(w)}`;
        const taken = !cmd.cond || condVal === cmd.cond.val;
        if (taken) {
          resultDesc = t === 'call'
            ? `ВЫЗОВ: SP=${ALU.hex4(sp - 2)}, стек←${ALU.hex4(pc + 3)}, PC=${ALU.hex4(w)}`
            : `ПЕРЕХОД: PC = ${ALU.hex4(w)}`;
        } else {
          resultDesc = `Пропуск: PC = ${ALU.hex4(pc + 3)}`;
        }
      } else if (t === 'ret') {
        const w = wordOf('c-word', 0x75c0), sp = wordOf('c-sp', 0x1ffe);
        const condVal = parseInt(valOf('c-condf', '0'), 10);
        if (cmd.cond) flags[cmd.cond.flag] = condVal;
        mnemStr = cmd.mnem;
        const taken = !cmd.cond || condVal === cmd.cond.val;
        resultDesc = taken ? `ВОЗВРАТ: PC=${ALU.hex4(w)}, SP=${ALU.hex4(sp + 2)}` : 'Условие ложно, возврата нет';
      } else if (t === 'io_in' || t === 'io_out') {
        const b2 = byteOf('c-b2', 1), a = byteOf('c-a', 0x55);
        mnemStr = `${cmd.mnem} ${ALU.hex2(b2)}`;
        resultDesc = t === 'io_in' ? `A = ${ALU.hex2(a)} из порта ${ALU.hex2(b2)}` : `В порт ${ALU.hex2(b2)} выдано ${ALU.hex2(a)}`;
      } else if (t === 'rst') {
        const n = parseInt(valOf('c-rst', '0'), 10), pc = wordOf('c-pc', 0), sp = wordOf('c-sp', 0x2000);
        mnemStr = `RST ${n}`;
        resultDesc = `SP=${ALU.hex4(sp - 2)}, стек←${ALU.hex4(pc + 1)}, PC=${ALU.hex4(n * 8)}`;
      } else if (t === 'cma') {
        const a = byteOf('c-a', 0);
        mnemStr = 'CMA';
        const res = (~a) & 0xff;
        resultDesc = `A = ${ALU.hex2(res)} (${ALU.bin8(res)}₂)`;
      } else if (t === 'stc') {
        mnemStr = 'STC';
        flags.Tc = 1; touched.Tc = true;
        resultDesc = 'Флаг переноса Tc = 1';
      } else if (t === 'cmc') {
        mnemStr = 'CMC';
        flags.Tc = flags.Tc ? 0 : 1; touched.Tc = true;
        resultDesc = `Флаг переноса инвертирован → Tc = ${flags.Tc}`;
      } else if (t === 'daa') {
        const a = byteOf('c-a', 0);
        mnemStr = 'DAA';
        const res = ALU.aluDaa(a, flags);
        touched.Tz = touched.Ts = touched.Tc = touched.Tv = touched.Tp = true;
        resultDesc = `A = ${ALU.hex2(res)} (BCD)`;
      } else {
        mnemStr = cmd.mnem;
        resultDesc = cmd.sysMsg || cmd.op;
      }

      const parsed = Parser.parseMnemonic(mnemStr);
      lastParsed = parsed.ok ? parsed : null;

      const flagNames = ['Tz', 'Ts', 'Tc', 'Tv', 'Tp'];
      outputEl.innerHTML = `
        <div class="calc-out-row"><span class="calc-out-label">Мнемоника</span><span class="calc-out-val">${parsed.ok ? parsed.mnemonic : mnemStr}</span></div>
        <div class="calc-out-row"><span class="calc-out-label">Содержание</span><span class="calc-out-val">${parsed.ok ? parsed.content : '—'}</span></div>
        <div class="calc-out-row"><span class="calc-out-label">Двоичный</span><span class="calc-out-val">${parsed.ok ? parsed.binaryList.join(' · ') : '—'}</span></div>
        <div class="calc-out-row"><span class="calc-out-label">16-рич.</span><span class="calc-out-val">${parsed.ok ? parsed.hexList.join(' ') : '—'}</span></div>
        <div class="calc-out-row"><span class="calc-out-label">Результат</span><span class="calc-out-val">${resultDesc}</span></div>
        <div class="calc-flags-live">
          ${flagNames.map(fn => `
            <div class="live-flag-box ${touched[fn] ? 'changed' : ''}">
              <span class="f-name">${fn}</span>
              <span class="f-val">${flags[fn]}</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    controlsEl.querySelectorAll('input, select').forEach(inp => {
      inp.addEventListener('input', recompute);
      inp.addEventListener('change', recompute);
    });
    recompute();

    addBtn.onclick = () => {
      if (!lastParsed) return;
      appState.rows.push({
        mnemonic: lastParsed.mnemonic,
        content: lastParsed.content,
        lastEdited: 'mnemonic'
      });
      appState.selectedRowIdx = appState.rows.length - 1;
      appState.activeSectionId = 'calc_table';
      appState.activeSubId = 'calc-main';
      saveState();
      closeDetailModal();
      renderApp();
    };
  }

  // ==================== РАЗДЕЛ КАЛЬКУЛЯЦИИ ====================
  function loadPresetRows(shouldSave = true) {
    appState.rows = NOTEBOOK_PRESET.map(r => ({
      mnemonic: r.mnemonic,
      content: r.content,
      lastEdited: 'mnemonic'
    }));
    appState.startAddress = '75B6h';
    appState.selectedRowIdx = 0;
    appState.simResult = null;
    if (shouldSave) saveState();
  }

  function evaluateRow(row) {
    const mode = row.lastEdited || 'mnemonic';
    const raw = mode === 'content' ? row.content : row.mnemonic;
    if (!raw || !raw.trim()) {
      return { ok: false, empty: true, byteCount: 1, binaryList: ['—'], hexList: ['—'] };
    }
    const parsed = mode === 'content' ? Parser.parseContent(raw) : Parser.parseMnemonic(raw);
    if (parsed.ok) {
      // Синхронизируем парное поле
      if (mode === 'content') row.mnemonic = parsed.mnemonic;
      else row.content = parsed.content;
      return parsed;
    }
    return { ok: false, error: parsed.error, byteCount: 1, binaryList: ['?'], hexList: ['?'] };
  }

  function renderCalculationSection(sec) {
    const startVal = Parser.parseNumber(appState.startAddress, 16);
    let currentAddr = startVal === null ? 0x75b6 : startVal;

    const evaluated = appState.rows.map(row => {
      const res = evaluateRow(row);
      const addrStart = currentAddr;
      const len = res.byteCount || 1;
      const byteAddrs = [];
      for (let i = 0; i < len; i++) {
        byteAddrs.push(ALU.hex4((addrStart + i) & 0xffff));
      }
      currentAddr = (currentAddr + len) & 0xffff;
      return { row, res, byteAddrs };
    });

    const colMeta = Object.fromEntries(DEFAULT_COLUMNS.map(c => [c.key, c]));

    let html = `
      <div class="section-banner">
        <h2>${sec.title}</h2>
        <p>Нажмите на «Мнемонику» или «Содержание» для автозаполнения всей строки через спец-клавиатуру</p>
      </div>

      <div id="calc-main" class="calc-toolbar">
        <div class="calc-toolbar-row">
          <label class="addr-input-chip">
            Старт:
            <input id="calc-start-addr" value="${escapeHtml(appState.startAddress)}" maxlength="5" />
          </label>
          <button id="btn-toggle-addrs" class="rune-action-btn" type="button">
            ${appState.showAddresses ? '№ + Адрес' : 'Только №'}
          </button>
          <button id="btn-toggle-cols" class="rune-action-btn" type="button">⇄ Столбцы</button>
        </div>

        <div class="calc-toolbar-row">
          <button id="btn-add-row" class="rune-action-btn gold" type="button">＋ Строка</button>
          <button id="btn-load-preset" class="rune-action-btn" type="button">📜 Из тетради</button>
          <button id="btn-clear-rows" class="rune-action-btn" type="button">🗑 Очистить</button>
          <button id="btn-run-sim" class="rune-action-btn gold" type="button">⚙ Прогон</button>
        </div>
    `;

    if (appState.showColumnManager) {
      html += `
        <div class="col-order-panel">
          <div class="col-order-title">Порядок столбцов таблицы (перемещайте кнопками):</div>
          <div class="col-order-list">
            ${appState.columnOrder.map((key, idx) => `
              <div class="col-order-item">
                <span>${idx + 1}. ${colMeta[key].label}</span>
                <div class="col-move-btns">
                  <button type="button" data-col-move="-1" data-col-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>▲</button>
                  <button type="button" data-col-move="1" data-col-idx="${idx}" ${idx === appState.columnOrder.length - 1 ? 'disabled' : ''}>▼</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    html += `</div>`;

    // Таблица
    html += `
      <div class="prog-table-wrap">
        <table class="prog-table">
          <thead>
            <tr>
              ${appState.columnOrder.map(key => `<th>${colMeta[key].label}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${evaluated.map((item, idx) => {
              const isSelected = idx === appState.selectedRowIdx;
              const isErr = !item.res.ok && !item.res.empty;
              const activeField = appState.editingCell && appState.editingCell.rowIdx === idx
                ? appState.editingCell.field : null;

              const cells = {
                num: `
                  <td class="cell-num-addr" data-select-row="${idx}">
                    <strong>#${idx + 1}</strong>
                    ${appState.showAddresses
                      ? item.byteAddrs.map(a => `<span class="addr-line">${a}</span>`).join('')
                      : `<span class="addr-line">${item.res.byteCount || 1}Б</span>`}
                  </td>
                `,
                mnemonic: `
                  <td>
                    <div class="cell-editable ${activeField === 'mnemonic' ? 'active-cell' : ''} ${!item.row.mnemonic ? 'empty-placeholder' : ''}"
                         data-edit-row="${idx}" data-edit-field="mnemonic">
                      ${item.row.mnemonic ? escapeHtml(item.row.mnemonic) : 'Ввести...'}
                    </div>
                    ${isErr && item.row.lastEdited !== 'content' ? `<div class="row-err-hint">${escapeHtml(item.res.error)}</div>` : ''}
                  </td>
                `,
                content: `
                  <td>
                    <div class="cell-editable ${activeField === 'content' ? 'active-cell' : ''} ${!item.row.content ? 'empty-placeholder' : ''}"
                         data-edit-row="${idx}" data-edit-field="content">
                      ${item.row.content ? escapeHtml(item.row.content) : 'Операция...'}
                    </div>
                    ${isErr && item.row.lastEdited === 'content' ? `<div class="row-err-hint">${escapeHtml(item.res.error)}</div>` : ''}
                  </td>
                `,
                binary: `
                  <td>
                    ${item.res.binaryList.map(b => `<span class="byte-line">${escapeHtml(b)}</span>`).join('')}
                  </td>
                `,
                hex: `
                  <td>
                    ${item.res.hexList.map(h => `<span class="byte-line"><strong>${escapeHtml(h)}</strong></span>`).join('')}
                  </td>
                `
              };

              return `<tr class="${isSelected ? 'row-selected' : ''} ${isErr ? 'row-error' : ''}">
                ${appState.columnOrder.map(k => cells[k]).join('')}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Панель действий с выбранной строкой
    if (appState.rows.length > 0 && appState.selectedRowIdx < appState.rows.length) {
      html += `
        <div class="row-tools-bar">
          <span>Строка #${appState.selectedRowIdx + 1}</span>
          <div class="row-tools-btns">
            <button type="button" id="row-up-btn">▲</button>
            <button type="button" id="row-down-btn">▼</button>
            <button type="button" id="row-dup-btn">Копия</button>
            <button type="button" id="row-del-btn">✕ Удалить</button>
          </div>
        </div>
      `;
    }

    // Симулятор
    html += `<div id="calc-sim">`;
    if (appState.simResult) {
      const s = appState.simResult;
      html += `
        <div class="sim-result-card">
          <div style="color:var(--gold-bright);font-weight:700;margin-bottom:4px;">⚙ Состояние Когитатора после прогона (${s.steps} команд):</div>
          <div class="sim-regs-grid">
            <div class="sim-reg-pill">A: <strong>${ALU.hex2(s.A)}</strong></div>
            <div class="sim-reg-pill">B: <strong>${ALU.hex2(s.B)}</strong></div>
            <div class="sim-reg-pill">C: <strong>${ALU.hex2(s.C)}</strong></div>
            <div class="sim-reg-pill">D: <strong>${ALU.hex2(s.D)}</strong></div>
            <div class="sim-reg-pill">E: <strong>${ALU.hex2(s.E)}</strong></div>
            <div class="sim-reg-pill">H: <strong>${ALU.hex2(s.H)}</strong></div>
            <div class="sim-reg-pill">L: <strong>${ALU.hex2(s.L)}</strong></div>
            <div class="sim-reg-pill">SP: <strong>${ALU.hex4(s.SP)}</strong></div>
          </div>
          <div class="calc-flags-live">
            ${['Tz', 'Ts', 'Tc', 'Tv', 'Tp'].map(fn => `
              <div class="live-flag-box changed">
                <span class="f-name">${fn}</span>
                <span class="f-val">${s.flags[fn]}</span>
              </div>
            `).join('')}
          </div>
          <ol class="step-trace-list" style="color:#dfc898;font-size:11px;margin-top:8px;">
            ${s.trace.map(t => `<li>${escapeHtml(t)}</li>`).join('')}
          </ol>
        </div>
      `;
    }
    html += `</div>`;

    elContent.innerHTML = html;

    // Привязки тулбара
    document.getElementById('calc-start-addr').addEventListener('change', e => {
      appState.startAddress = e.target.value.trim() || '75B6h';
      saveState();
      renderMainContent();
    });

    document.getElementById('btn-toggle-addrs').addEventListener('click', () => {
      appState.showAddresses = !appState.showAddresses;
      saveState();
      renderMainContent();
    });

    document.getElementById('btn-toggle-cols').addEventListener('click', () => {
      appState.showColumnManager = !appState.showColumnManager;
      renderMainContent();
    });

    elContent.querySelectorAll('[data-col-move]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.colIdx, 10);
        const dir = parseInt(btn.dataset.colMove, 10);
        const next = idx + dir;
        if (next < 0 || next >= appState.columnOrder.length) return;
        const arr = appState.columnOrder;
        [arr[idx], arr[next]] = [arr[next], arr[idx]];
        saveState();
        renderMainContent();
      });
    });

    document.getElementById('btn-add-row').addEventListener('click', () => {
      appState.rows.push({ mnemonic: '', content: '', lastEdited: 'mnemonic' });
      const newIdx = appState.rows.length - 1;
      appState.selectedRowIdx = newIdx;
      saveState();
      openKeyboard(newIdx, 'mnemonic');
    });

    document.getElementById('btn-load-preset').addEventListener('click', () => {
      loadPresetRows(true);
      closeKeyboard();
      renderMainContent();
    });

    document.getElementById('btn-clear-rows').addEventListener('click', () => {
      appState.rows = [{ mnemonic: '', content: '', lastEdited: 'mnemonic' }];
      appState.selectedRowIdx = 0;
      appState.simResult = null;
      saveState();
      closeKeyboard();
      renderMainContent();
    });

    document.getElementById('btn-run-sim').addEventListener('click', runProgramSimulation);

    elContent.querySelectorAll('[data-select-row]').forEach(td => {
      td.addEventListener('click', () => {
        appState.selectedRowIdx = parseInt(td.dataset.selectRow, 10);
        renderMainContent();
      });
    });

    elContent.querySelectorAll('[data-edit-row]').forEach(cell => {
      cell.addEventListener('click', () => {
        const rowIdx = parseInt(cell.dataset.editRow, 10);
        const field = cell.dataset.editField;
        appState.selectedRowIdx = rowIdx;
        openKeyboard(rowIdx, field);
      });
    });

    const btnUp = document.getElementById('row-up-btn');
    const btnDown = document.getElementById('row-down-btn');
    const btnDup = document.getElementById('row-dup-btn');
    const btnDel = document.getElementById('row-del-btn');
    if (btnUp) {
      btnUp.onclick = () => moveSelectedRow(-1);
      btnDown.onclick = () => moveSelectedRow(1);
      btnDup.onclick = () => {
        const src = appState.rows[appState.selectedRowIdx];
        appState.rows.splice(appState.selectedRowIdx + 1, 0, { ...src });
        appState.selectedRowIdx++;
        saveState();
        renderMainContent();
      };
      btnDel.onclick = () => {
        if (appState.rows.length <= 1) {
          appState.rows[0] = { mnemonic: '', content: '', lastEdited: 'mnemonic' };
        } else {
          appState.rows.splice(appState.selectedRowIdx, 1);
          if (appState.selectedRowIdx >= appState.rows.length) appState.selectedRowIdx--;
        }
        closeKeyboard();
        saveState();
        renderMainContent();
      };
    }
  }

  function moveSelectedRow(dir) {
    const i = appState.selectedRowIdx;
    const j = i + dir;
    if (j < 0 || j >= appState.rows.length) return;
    [appState.rows[i], appState.rows[j]] = [appState.rows[j], appState.rows[i]];
    appState.selectedRowIdx = j;
    saveState();
    renderMainContent();
  }

  function runProgramSimulation() {
    const state = ALU.createDefaultState();
    const startVal = Parser.parseNumber(appState.startAddress, 16);
    state.PC = startVal === null ? 0x75b6 : startVal;
    const trace = [];
    let steps = 0;

    appState.rows.forEach((row, idx) => {
      const mode = row.lastEdited || 'mnemonic';
      const parsed = mode === 'content' ? Parser.parseContent(row.content) : Parser.parseMnemonic(row.mnemonic);
      if (parsed.ok && !state.halted) {
        const note = ALU.stepParsed(state, parsed, parsed.byteCount);
        steps++;
        trace.push(`#${idx + 1} ${parsed.mnemonic} → ${note}`);
      }
    });

    appState.simResult = { ...state, steps, trace };
    renderMainContent();
    const simEl = document.getElementById('calc-sim');
    if (simEl) simEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  // ==================== СПЕЦИАЛЬНАЯ РУНИЧЕСКАЯ КЛАВИАТУРА ====================
  const MNEM_LAYOUTS = {
    ops: {
      label: 'Команды',
      rows: [
        ['MOV ', 'MVI ', 'LXI ', 'LDA ', 'STA '],
        ['ADD ', 'SUB ', 'INR ', 'DCR ', 'SUI '],
        ['ANA ', 'XRA ', 'ORA ', 'CMP ', 'CMA'],
        ['JMP ', 'JZ ', 'JNZ ', 'CALL ', 'RET']
      ]
    },
    more: {
      label: 'Стек/АЛУ',
      rows: [
        ['PUSH ', 'POP ', 'DAD ', 'INX ', 'DCX '],
        ['ADI ', 'ACI ', 'SBI ', 'ANI ', 'ORI '],
        ['RLC', 'RRC', 'RAL', 'RAR', 'DAA'],
        ['STAX ', 'LDAX ', 'XCH', 'NOP', 'HLT']
      ]
    },
    regs: {
      label: 'Рег/Hex',
      rows: [
        ['A', 'B', 'C', 'D', 'E', 'H', 'L', 'M'],
        ['BC', 'DE', 'HL', 'SP', 'PSW', ', ', ' '],
        ['0', '1', '2', '3', '4', '5', '6', '7'],
        ['8', '9', 'A', 'B', 'C', 'D', 'E', 'F', 'h']
      ]
    }
  };

  const CONTENT_LAYOUTS = {
    ops: {
      label: 'Символы',
      rows: [
        [' ← ', ' ↔ ', '(', ')', '<', '>'],
        ['[', ']', ' + ', ' - ', ' ∧ ', ' ∨ '],
        [' ⊕ ', 'Ā', ' + 1', ' - 1', '; ', 'Tc'],
        ['Если (Tz)=0, то ', 'Если (Tz)=1, то ', 'PC ← ']
      ]
    },
    regs: {
      label: 'Рег/Hex',
      rows: [
        ['A', 'B', 'C', 'D', 'E', 'H', 'L', 'M'],
        ['(A)', '(B)', '(C)', '(D)', '(E)', '(H)', '(L)', '(M)'],
        ['0', '1', '2', '3', '4', '5', '6', '7'],
        ['8', '9', 'A', 'B', 'C', 'D', 'E', 'F', 'h']
      ]
    },
    tpl: {
      label: 'Шаблоны',
      rows: [
        ['A ← (A) - <', 'A ← (A) ∨ (', 'A ← (Ā)'],
        ['B ← <', 'C ← <', 'A ← ('],
        ['HL ← (HL) + (', 'SP ← (HL)', 'Tc ← 1']
      ]
    }
  };

  function openKeyboard(rowIdx, field) {
    appState.editingCell = { rowIdx, field };
    appState.kbTab = 'ops';
    elKeyboard.classList.remove('hidden');
    elPageScroll.classList.add('keyboard-open');
    renderMainContent();
    renderKeyboard();

    setTimeout(() => {
      const activeCell = elContent.querySelector('.active-cell');
      if (activeCell) activeCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  }

  function closeKeyboard() {
    appState.editingCell = null;
    elKeyboard.classList.add('hidden');
    elPageScroll.classList.remove('keyboard-open');
    if (appState.activeSectionId === 'calc_table') {
      renderMainContent();
    }
  }

  function insertTokenToActiveCell(token) {
    if (!appState.editingCell) return;
    const { rowIdx, field } = appState.editingCell;
    const row = appState.rows[rowIdx];
    row[field] = (row[field] || '') + token;
    row.lastEdited = field;
    saveState();
    renderMainContent();
    updateKeyboardHeaderStatus();
  }

  function backspaceActiveCell() {
    if (!appState.editingCell) return;
    const { rowIdx, field } = appState.editingCell;
    const row = appState.rows[rowIdx];
    const cur = row[field] || '';
    row[field] = cur.slice(0, -1);
    row.lastEdited = field;
    saveState();
    renderMainContent();
    updateKeyboardHeaderStatus();
  }

  function clearActiveCell() {
    if (!appState.editingCell) return;
    const { rowIdx, field } = appState.editingCell;
    appState.rows[rowIdx][field] = '';
    appState.rows[rowIdx].lastEdited = field;
    saveState();
    renderMainContent();
    updateKeyboardHeaderStatus();
  }

  function updateKeyboardHeaderStatus() {
    if (!appState.editingCell) return;
    const { rowIdx, field } = appState.editingCell;
    const row = appState.rows[rowIdx];
    const text = row[field] || '';
    elKbTarget.textContent = field === 'mnemonic' ? `Мнемоника #${rowIdx + 1}` : `Содержание #${rowIdx + 1}`;
    elKbPreview.textContent = text || 'пусто';

    if (!text.trim()) {
      elKbStatus.className = 'kb-status';
      elKbStatus.textContent = field === 'mnemonic' ? 'Введите мнемонику (напр. MVI B, 43h)' : 'Введите операцию (напр. B ← <43h>)';
      return;
    }

    const res = field === 'content' ? Parser.parseContent(text) : Parser.parseMnemonic(text);
    if (res.ok) {
      elKbStatus.className = 'kb-status';
      elKbStatus.textContent = `✓ ${res.mnemonic} · ${res.hexList.join(' ')} · ${res.binaryList.join(' ')}`;
    } else {
      elKbStatus.className = 'kb-status err';
      elKbStatus.textContent = `… ${res.error}`;
    }
  }

  function renderKeyboard() {
    if (!appState.editingCell) return;
    const { field, rowIdx } = appState.editingCell;
    updateKeyboardHeaderStatus();

    const layouts = field === 'content' ? CONTENT_LAYOUTS : MNEM_LAYOUTS;
    if (!layouts[appState.kbTab]) appState.kbTab = 'ops';

    elKbModeBtn.textContent = appState.kbNativeMode ? '⚙ Рунич.' : '⌨ Системн.';

    if (appState.kbNativeMode) {
      elKbTabs.innerHTML = '';
      elKbBody.innerHTML = `
        <input id="kb-native-field" class="kb-native-input"
               value="${escapeHtml(appState.rows[rowIdx][field] || '')}"
               placeholder="${field === 'mnemonic' ? 'Например: SUI 25h' : 'Например: A ← (A) - <25h>'}" />
      `;
      const nativeInp = document.getElementById('kb-native-field');
      nativeInp.focus();
      nativeInp.addEventListener('input', e => {
        appState.rows[rowIdx][field] = e.target.value;
        appState.rows[rowIdx].lastEdited = field;
        saveState();
        renderMainContent();
        updateKeyboardHeaderStatus();
      });
      return;
    }

    elKbTabs.innerHTML = Object.entries(layouts).map(([k, v]) => `
      <button type="button" class="kb-tab-btn ${appState.kbTab === k ? 'active' : ''}" data-kbtab="${k}">${v.label}</button>
    `).join('');

    elKbTabs.querySelectorAll('[data-kbtab]').forEach(btn => {
      btn.addEventListener('click', () => {
        appState.kbTab = btn.dataset.kbtab;
        renderKeyboard();
      });
    });

    const rows = layouts[appState.kbTab].rows;
    let bodyHtml = rows.map(row => `
      <div class="kb-row" style="grid-template-columns:repeat(${row.length}, minmax(0, 1fr));">
        ${row.map(tok => `
          <button type="button" class="kb-key" data-token="${escapeHtml(tok)}">
            ${tok === ' ' ? '␣' : escapeHtml(tok.trim() || tok)}
          </button>
        `).join('')}
      </div>
    `).join('');

    bodyHtml += `
      <div class="kb-row" style="grid-template-columns: 1fr 1fr 1fr 1.2fr;">
        <button type="button" class="kb-key util" id="kb-space-btn">Пробел</button>
        <button type="button" class="kb-key util" id="kb-clear-btn">Сброс</button>
        <button type="button" class="kb-key danger" id="kb-bs-btn">⌫</button>
        <button type="button" class="kb-key util" id="kb-next-btn">След. ↵</button>
      </div>
    `;

    elKbBody.innerHTML = bodyHtml;

    elKbBody.querySelectorAll('[data-token]').forEach(btn => {
      btn.addEventListener('click', () => insertTokenToActiveCell(btn.dataset.token));
    });
    document.getElementById('kb-space-btn').addEventListener('click', () => insertTokenToActiveCell(' '));
    document.getElementById('kb-clear-btn').addEventListener('click', clearActiveCell);
    document.getElementById('kb-bs-btn').addEventListener('click', backspaceActiveCell);
    document.getElementById('kb-next-btn').addEventListener('click', () => {
      const nextIdx = appState.editingCell.rowIdx + 1;
      if (nextIdx >= appState.rows.length) {
        appState.rows.push({ mnemonic: '', content: '', lastEdited: field });
      }
      appState.selectedRowIdx = nextIdx;
      saveState();
      openKeyboard(nextIdx, field);
    });
  }

  function initKeyboardButtons() {
    document.getElementById('kb-close-btn').addEventListener('click', closeKeyboard);
    elKbModeBtn.addEventListener('click', () => {
      appState.kbNativeMode = !appState.kbNativeMode;
      renderKeyboard();
    });
  }

  function renderApp() {
    renderTopTabs();
    renderRightTabs();
    renderMainContent();
  }

  // Старт приложения
  document.addEventListener('DOMContentLoaded', () => {
    loadState();
    initRitualAndCover();
    initTopControls();
    initKeyboardButtons();
    renderApp();
  });
})();