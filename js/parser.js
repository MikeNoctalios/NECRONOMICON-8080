window.NecroParser = (function () {
  const REG_CODE = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, M: 6, A: 7 };
  const CODE_REG = ['B', 'C', 'D', 'E', 'H', 'L', 'M', 'A'];

  const PAIR_MAP = {
    B: { idx: 0, hi: 'B', lo: 'C', label: 'BC' },
    BC: { idx: 0, hi: 'B', lo: 'C', label: 'BC' },
    D: { idx: 1, hi: 'D', lo: 'E', label: 'DE' },
    DE: { idx: 1, hi: 'D', lo: 'E', label: 'DE' },
    H: { idx: 2, hi: 'H', lo: 'L', label: 'HL' },
    HL: { idx: 2, hi: 'H', lo: 'L', label: 'HL' },
    SP: { idx: 3, hi: 'SP', lo: 'SP', label: 'SP' }
  };

  const STACK_PAIR_MAP = {
    B: { idx: 0, hi: 'B', lo: 'C', label: 'B' },
    BC: { idx: 0, hi: 'B', lo: 'C', label: 'B' },
    D: { idx: 1, hi: 'D', lo: 'E', label: 'D' },
    DE: { idx: 1, hi: 'D', lo: 'E', label: 'D' },
    H: { idx: 2, hi: 'H', lo: 'L', label: 'H' },
    HL: { idx: 2, hi: 'H', lo: 'L', label: 'H' },
    PSW: { idx: 3, hi: 'A', lo: 'F', label: 'PSW' },
    AF: { idx: 3, hi: 'A', lo: 'F', label: 'PSW' }
  };

  const COND_MAP = {
    NZ: { code: 0, flag: 'Tz', val: 0 },
    Z:  { code: 1, flag: 'Tz', val: 1 },
    NC: { code: 2, flag: 'Tc', val: 0 },
    C:  { code: 3, flag: 'Tc', val: 1 },
    PO: { code: 4, flag: 'Tp', val: 0 },
    PE: { code: 5, flag: 'Tp', val: 1 },
    P:  { code: 6, flag: 'Ts', val: 0 },
    M:  { code: 7, flag: 'Ts', val: 1 }
  };

  const ALU_OPS = { ADD: 0, ADC: 1, SUB: 2, SBB: 3, ANA: 4, XRA: 5, ORA: 6, CMP: 7, CMR: 7 };
  const ALU_IMM_OPS = { ADI: 0, ACI: 1, SUI: 2, SBI: 3, ANI: 4, XRI: 5, ORI: 6, CPI: 7 };

  function fmtByteHex(v) {
    return ((v & 0xff) >>> 0).toString(16).toUpperCase().padStart(2, '0') + 'h';
  }

  function fmtWordHex(v) {
    return ((v & 0xffff) >>> 0).toString(16).toUpperCase().padStart(4, '0') + 'h';
  }

  function fmtBinGrouped(v) {
    const b = ((v & 0xff) >>> 0).toString(2).padStart(8, '0');
    return b.slice(0, 2) + ' ' + b.slice(2, 5) + ' ' + b.slice(5);
  }

  function parseNumber(str, maxBits) {
    if (!str) return null;
    let s = str.trim().replace(/^[<\[(\s]+|[>\])\s]+$/g, '').toUpperCase();
    if (!s) return null;
    let val = NaN;
    if (s.startsWith('0X')) {
      val = parseInt(s.slice(2), 16);
    } else if (s.startsWith('$')) {
      val = parseInt(s.slice(1), 16);
    } else if (s.endsWith('H')) {
      const body = s.slice(0, -1);
      if (/^[0-9A-F]+$/.test(body)) val = parseInt(body, 16);
    } else if (s.endsWith('B') && /^[01]+B$/.test(s)) {
      val = parseInt(s.slice(0, -1), 2);
    } else if (/^[0-9]+$/.test(s)) {
      val = parseInt(s, 10);
    } else if (/^[0-9A-F]+$/.test(s)) {
      val = parseInt(s, 16);
    }
    if (isNaN(val) || val < 0) return null;
    const limit = maxBits === 16 ? 0xffff : 0xff;
    if (val > limit) return null;
    return val;
  }

  function buildResult(mnemonic, content, bytes, meta) {
    return {
      ok: true,
      mnemonic,
      content,
      bytes,
      byteCount: bytes.length,
      binaryList: bytes.map((b, i) => `B${i + 1}: ${fmtBinGrouped(b)}`),
      hexList: bytes.map(b => fmtByteHex(b)),
      op: meta.op,
      arg1: meta.arg1 !== undefined ? meta.arg1 : null,
      arg2: meta.arg2 !== undefined ? meta.arg2 : null
    };
  }

  function fail(msg) {
    return { ok: false, error: msg };
  }

  function parseMnemonic(raw) {
    if (!raw || !raw.trim()) return fail('Пустая строка мнемоники');
    const clean = raw.trim().replace(/\s+/g, ' ').toUpperCase();
    const firstSpace = clean.indexOf(' ');
    let op = firstSpace === -1 ? clean : clean.slice(0, firstSpace);
    const rest = firstSpace === -1 ? '' : clean.slice(firstSpace + 1).trim();
    const args = rest ? rest.split(',').map(s => s.trim()).filter(Boolean) : [];

    // Алиасы из методички
    if (op === 'XCH') op = 'XCHG';
    if (op === 'XTH') op = 'XTHL';
    if (op === 'CMR') op = 'CMP';

    if (op === 'MOV') {
      if (args.length !== 2) return fail('MOV требует 2 регистра: MOV dst, src');
      const d = REG_CODE[args[0]], s = REG_CODE[args[1]];
      if (d === undefined || s === undefined) return fail('Неверный регистр (допустимо A,B,C,D,E,H,L,M)');
      if (d === 6 && s === 6) return fail('MOV M, M (76h) — запрещённая форма HLT');
      return buildResult(`MOV ${args[0]}, ${args[1]}`, `${args[0]} ← (${args[1]})`, [0x40 | (d << 3) | s], { op: 'MOV', arg1: args[0], arg2: args[1] });
    }

    if (op === 'MVI') {
      if (args.length !== 2) return fail('MVI требует регистр и байт: MVI r, 43h');
      const d = REG_CODE[args[0]];
      const imm = parseNumber(args[1], 8);
      if (d === undefined) return fail('Неверный регистр в MVI');
      if (imm === null) return fail('Неверный 8-битный операнд (например 43h)');
      return buildResult(`MVI ${args[0]}, ${fmtByteHex(imm)}`, `${args[0]} ← <${fmtByteHex(imm)}>`, [(d << 3) | 0x06, imm], { op: 'MVI', arg1: args[0], arg2: imm });
    }

    if (op === 'LXI') {
      if (args.length !== 2) return fail('LXI требует пару и 16-бит адрес: LXI H, 75B6h');
      const p = PAIR_MAP[args[0]];
      const word = parseNumber(args[1], 16);
      if (!p) return fail('Допустимые пары: B, D, H, SP');
      if (word === null) return fail('Неверное 16-битное число');
      const lo = word & 0xff, hi = (word >> 8) & 0xff;
      const mnemPair = p.label === 'SP' ? 'SP' : p.hi;
      const content = p.label === 'SP'
        ? `SP ← <${fmtWordHex(word)}>`
        : `${p.hi} ← <${fmtByteHex(hi)}>; ${p.lo} ← <${fmtByteHex(lo)}>`;
      return buildResult(`LXI ${mnemPair}, ${fmtWordHex(word)}`, content, [(p.idx << 4) | 0x01, lo, hi], { op: 'LXI', arg1: p.label, arg2: word });
    }

    if (op === 'STAX' || op === 'LDAX') {
      if (args.length !== 1) return fail(`${op} требует пару B или D`);
      const p = PAIR_MAP[args[0]];
      if (!p || (p.idx !== 0 && p.idx !== 1)) return fail(`${op} работает только с BC или DE`);
      const code = op === 'STAX' ? ((p.idx << 4) | 0x02) : ((p.idx << 4) | 0x0a);
      const content = op === 'STAX' ? `[(${p.label})] ← (A)` : `A ← [(${p.label})]`;
      return buildResult(`${op} ${p.hi}`, content, [code], { op, arg1: p.label });
    }

    if (op === 'SHLD' || op === 'LHLD' || op === 'STA' || op === 'LDA') {
      if (args.length !== 1) return fail(`${op} требует 16-битный адрес`);
      const addr = parseNumber(args[0], 16);
      if (addr === null) return fail('Неверный 16-битный адрес');
      const lo = addr & 0xff, hi = (addr >> 8) & 0xff;
      const opcodes = { SHLD: 0x22, LHLD: 0x2a, STA: 0x32, LDA: 0x3a };
      const addrStr = fmtWordHex(addr);
      const contents = {
        SHLD: `[<${addrStr}>] ← (L); [<${addrStr}>+1] ← (H)`,
        LHLD: `L ← [<${addrStr}>]; H ← [<${addrStr}>+1]`,
        STA: `[<${addrStr}>] ← (A)`,
        LDA: `A ← [<${addrStr}>]`
      };
      return buildResult(`${op} ${addrStr}`, contents[op], [opcodes[op], lo, hi], { op, arg1: addr });
    }

    if (op === 'PUSH' || op === 'POP') {
      if (args.length !== 1) return fail(`${op} требует пару B, D, H или PSW`);
      const p = STACK_PAIR_MAP[args[0]];
      if (!p) return fail('Для стека допустимы: B, D, H, PSW');
      const code = (op === 'PUSH' ? 0xc5 : 0xc1) | (p.idx << 4);
      const content = op === 'PUSH'
        ? `[SP-1] ← (${p.hi}); [SP-2] ← (${p.lo}); SP ← (SP)-2`
        : `${p.lo} ← [SP]; ${p.hi} ← [SP+1]; SP ← (SP)+2`;
      return buildResult(`${op} ${p.label}`, content, [code], { op, arg1: p.label });
    }

    if (op === 'XCHG') return buildResult('XCH', '(H) ↔ (D); (L) ↔ (E)', [0xeb], { op: 'XCHG' });
    if (op === 'XTHL') return buildResult('XTH', '(L) ↔ [(SP)]; (H) ↔ [(SP)+1]', [0xe3], { op: 'XTHL' });
    if (op === 'SPHL') return buildResult('SPHL', 'SP ← (HL)', [0xf9], { op: 'SPHL' });
    if (op === 'PCHL') return buildResult('PCHL', 'PC ← (HL)', [0xe9], { op: 'PCHL' });

    if (op === 'INR' || op === 'DCR') {
      if (args.length !== 1 || REG_CODE[args[0]] === undefined) return fail(`${op} требует регистр A..M`);
      const r = REG_CODE[args[0]];
      const code = (r << 3) | (op === 'INR' ? 0x04 : 0x05);
      const sign = op === 'INR' ? '+' : '-';
      return buildResult(`${op} ${args[0]}`, `${args[0]} ← (${args[0]}) ${sign} 1`, [code], { op, arg1: args[0] });
    }

    if (op === 'INX' || op === 'DCX' || op === 'DAD') {
      if (args.length !== 1) return fail(`${op} требует пару B, D, H или SP`);
      const p = PAIR_MAP[args[0]];
      if (!p) return fail('Допустимые пары: B, D, H, SP');
      const base = op === 'INX' ? 0x03 : op === 'DCX' ? 0x0b : 0x09;
      const code = (p.idx << 4) | base;
      const mnemPair = p.label === 'SP' ? 'SP' : p.hi;
      const pairDisp = p.label;
      let content = '';
      if (op === 'INX') content = `${pairDisp} ← (${pairDisp}) + 1`;
      else if (op === 'DCX') content = `${pairDisp} ← (${pairDisp}) - 1`;
      else content = `HL ← (HL) + (${pairDisp})`;
      return buildResult(`${op} ${mnemPair}`, content, [code], { op, arg1: p.label });
    }

    if (ALU_OPS[op] !== undefined) {
      let regArg = args.length === 2 && args[0] === 'A' ? args[1] : args[0];
      if (args.length < 1 || args.length > 2 || REG_CODE[regArg] === undefined) {
        return fail(`${op} требует регистр (например ${op} C)`);
      }
      const k2 = ALU_OPS[op], r = REG_CODE[regArg];
      const symMap = {
        ADD: `A ← (A) + (${regArg})`,
        ADC: `A ← (A) + (${regArg}) + (Tc)`,
        SUB: `A ← (A) - (${regArg})`,
        SBB: `A ← (A) - (${regArg}) - (Tc)`,
        ANA: `A ← (A) ∧ (${regArg})`,
        XRA: `A ← (A) ⊕ (${regArg})`,
        ORA: `A ← (A) ∨ (${regArg})`,
        CMP: `(A) - (${regArg}) Сравнение`
      };
      return buildResult(`${op} ${regArg}`, symMap[op], [0x80 | (k2 << 3) | r], { op, arg1: regArg });
    }

    if (ALU_IMM_OPS[op] !== undefined) {
      // Допускаем запись из тетради вида "SUI A, 25h" и классическую "SUI 25h"
      let immStr = args.length === 2 && args[0] === 'A' ? args[1] : args[0];
      const imm = parseNumber(immStr, 8);
      if (args.length < 1 || args.length > 2 || imm === null) {
        return fail(`${op} требует байт (например ${op} 25h)`);
      }
      const k2 = ALU_IMM_OPS[op];
      const h = fmtByteHex(imm);
      const symMap = {
        ADI: `A ← (A) + <${h}>`,
        ACI: `A ← (A) + <${h}> + (Tc)`,
        SUI: `A ← (A) - <${h}>`,
        SBI: `A ← (A) - <${h}> - (Tc)`,
        ANI: `A ← (A) ∧ <${h}>`,
        XRI: `A ← (A) ⊕ <${h}>`,
        ORI: `A ← (A) ∨ <${h}>`,
        CPI: `(A) - <${h}> Сравнение`
      };
      return buildResult(`${op} ${h}`, symMap[op], [0xc6 | (k2 << 3), imm], { op, arg1: imm });
    }

    if (op === 'RLC' || op === 'RRC' || op === 'RAL' || op === 'RAR') {
      const codes = { RLC: 0x07, RRC: 0x0f, RAL: 0x17, RAR: 0x1f };
      const contents = {
        RLC: 'Aₘ₊₁←(Aₘ); A₀←(A₇); Tc←(A₇)',
        RRC: 'Aₘ←(Aₘ₊₁); A₇←(A₀); Tc←(A₀)',
        RAL: 'Aₘ₊₁←(Aₘ); A₀←(Tc); Tc←(A₇)',
        RAR: 'Aₘ←(Aₘ₊₁); A₇←(Tc); Tc←(A₀)'
      };
      return buildResult(op, contents[op], [codes[op]], { op });
    }

    if (op === 'JMP' || (op.startsWith('J') && COND_MAP[op.slice(1)])) {
      if (args.length !== 1) return fail(`${op} требует 16-битный адрес`);
      const addr = parseNumber(args[0], 16);
      if (addr === null) return fail('Неверный адрес перехода');
      const lo = addr & 0xff, hi = (addr >> 8) & 0xff;
      const addrStr = fmtWordHex(addr);
      if (op === 'JMP') return buildResult(`JMP ${addrStr}`, `PC ← <${addrStr}>`, [0xc3, lo, hi], { op: 'JMP', arg1: addr });
      const c = COND_MAP[op.slice(1)];
      return buildResult(`${op} ${addrStr}`, `Если (${c.flag})=${c.val}, то PC ← <${addrStr}>`, [0xc2 | (c.code << 3), lo, hi], { op, arg1: addr });
    }

    if (op === 'CALL' || (op.startsWith('C') && COND_MAP[op.slice(1)])) {
      if (args.length !== 1) return fail(`${op} требует 16-битный адрес`);
      const addr = parseNumber(args[0], 16);
      if (addr === null) return fail('Неверный адрес вызова');
      const lo = addr & 0xff, hi = (addr >> 8) & 0xff;
      const addrStr = fmtWordHex(addr);
      if (op === 'CALL') {
        return buildResult(`CALL ${addrStr}`, `[(SP)-1][(SP)-2]←(PC); SP←(SP)-2; PC←<${addrStr}>`, [0xcd, lo, hi], { op: 'CALL', arg1: addr });
      }
      const c = COND_MAP[op.slice(1)];
      return buildResult(`${op} ${addrStr}`, `Если (${c.flag})=${c.val}, то вызов <${addrStr}>`, [0xc4 | (c.code << 3), lo, hi], { op, arg1: addr });
    }

    if (op === 'RET' || (op.startsWith('R') && COND_MAP[op.slice(1)])) {
      if (op === 'RET') return buildResult('RET', 'PC ← [(SP)][(SP)+1]; SP ← (SP)+2', [0xc9], { op: 'RET' });
      const c = COND_MAP[op.slice(1)];
      return buildResult(op, `Если (${c.flag})=${c.val}, то PC←[(SP)][(SP)+1]; SP←(SP)+2`, [0xc0 | (c.code << 3)], { op });
    }

    if (op === 'IN' || op === 'OUT') {
      if (args.length !== 1) return fail(`${op} требует 8-битный номер порта`);
      const port = parseNumber(args[0], 8);
      if (port === null) return fail('Неверный номер порта (00h..FFh)');
      const pHex = fmtByteHex(port);
      const code = op === 'IN' ? 0xdb : 0xd3;
      const content = op === 'IN' ? `A ← (входной порт <${pHex}>)` : `Шина данных [порт <${pHex}>] ← (A)`;
      return buildResult(`${op} ${pHex}`, content, [code, port], { op, arg1: port });
    }

    if (op === 'RST') {
      if (args.length !== 1 || !/^[0-7]$/.test(args[0])) return fail('RST требует вектор от 0 до 7');
      const n = parseInt(args[0], 10);
      const addr = fmtWordHex(n * 8);
      return buildResult(`RST ${n}`, `[(SP)-1][(SP)-2]←(PC); SP←(SP)-2; PC←${addr}`, [0xc7 | (n << 3)], { op: 'RST', arg1: n });
    }

    if (op === 'CMA') return buildResult('CMA', 'A ← (Ā)', [0x2f], { op: 'CMA' });
    if (op === 'STC') return buildResult('STC', 'Tc ← 1', [0x37], { op: 'STC' });
    if (op === 'CMC') return buildResult('CMC', 'Tc ← (~Tc)', [0x3f], { op: 'CMC' });
    if (op === 'EI')  return buildResult('EI', 'Разрешение прерываний', [0xfb], { op: 'EI' });
    if (op === 'DI')  return buildResult('DI', 'Блокировка прерываний', [0xf3], { op: 'DI' });
    if (op === 'DAA') return buildResult('DAA', 'Двоично-десятичное представление (A)', [0x27], { op: 'DAA' });
    if (op === 'NOP') return buildResult('NOP', 'Отсутствие операции', [0x00], { op: 'NOP' });
    if (op === 'HLT') return buildResult('HLT', 'Останов', [0x76], { op: 'HLT' });

    return fail(`Неизвестная руна: ${op}`);
  }

  // ОБРАТНЫЙ ПАРСЕР: из Содержания (RTL-выражения) в Мнемонику + Бинарный + 16-ричный код
  function parseContent(raw) {
    if (!raw || !raw.trim()) return fail('Пустое содержание');
    let s = raw.trim()
      .replace(/<-|<=/g, '←')
      .replace(/<->/g, '↔')
      .replace(/\s+/g, ' ');

    const u = s.toUpperCase();

    // Простые системные фразы
    if (/^(ОТСУТСТВИЕ ОПЕРАЦИИ|NOP)$/.test(u)) return parseMnemonic('NOP');
    if (/^(ОСТАНОВ|HLT)$/.test(u)) return parseMnemonic('HLT');
    if (/РАЗРЕШЕНИЕ ПРЕРЫВАНИЙ|^EI$/.test(u)) return parseMnemonic('EI');
    if (/БЛОКИРОВКА ПРЕРЫВАНИЙ|^DI$/.test(u)) return parseMnemonic('DI');
    if (/ДВОИЧНО-ДЕСЯТИЧ|^DAA$/.test(u)) return parseMnemonic('DAA');

    // Циклические сдвиги
    if (/A[МM]?\+?1\s*←.*A₀\s*←\s*\(A₇\)/.test(u) || /^RLC$/.test(u)) return parseMnemonic('RLC');
    if (/A[МM]\s*←\s*\(A[МM]?\+?1\).*A₇\s*←\s*\(A₀\)/.test(u) || /^RRC$/.test(u)) return parseMnemonic('RRC');
    if (/A[МM]?\+?1\s*←.*A₀\s*←\s*\(TC\)/.test(u) || /^RAL$/.test(u)) return parseMnemonic('RAL');
    if (/A[МM]\s*←\s*\(A[МM]?\+?1\).*A₇\s*←\s*\(TC\)/.test(u) || /^RAR$/.test(u)) return parseMnemonic('RAR');

    // Инверсии / Флаги
    if (/^A\s*←\s*\(?\s*(Ā|~A|!A|НЕ\s*A)\s*\)?$/.test(u) || /^A\s*←\s*~\(\s*A\s*\)$/.test(u)) return parseMnemonic('CMA');
    if (/^TC\s*←\s*1$/.test(u)) return parseMnemonic('STC');
    if (/^TC\s*←\s*\(?[~!]TC\)?$/.test(u)) return parseMnemonic('CMC');

    // Обмены и пересылки HL/SP/PC
    if (/(\(H\)\s*↔\s*\(D\)|DE\s*↔\s*HL)/.test(u)) return parseMnemonic('XCHG');
    if (/(\(L\)\s*↔\s*\[\(?SP\)?\]|HL\s*↔\s*\[SP\])/.test(u)) return parseMnemonic('XTHL');
    if (/^SP\s*←\s*\(?\s*HL\s*\)?$/.test(u)) return parseMnemonic('SPHL');
    if (/^PC\s*←\s*\(?\s*HL\s*\)?$/.test(u)) return parseMnemonic('PCHL');

    // Ввод / Вывод
    let m = u.match(/^A\s*←\s*\(ВХОД.*?(?:ПОРТ)?\s*<?([0-9A-FH$X]+)>?\)$/);
    if (m) {
      const p = parseNumber(m[1], 8);
      if (p !== null) return parseMnemonic(`IN ${fmtByteHex(p)}`);
    }
    m = u.match(/^ШИНА ДАННЫХ\s*(?:\[ПОРТ\s*<?([0-9A-FH$X]+)>?\])?\s*←\s*\(A\)$/);
    if (m) {
      const p = m[1] ? parseNumber(m[1], 8) : 0;
      if (p !== null) return parseMnemonic(`OUT ${fmtByteHex(p)}`);
    }

    // Условные переходы / вызовы / возвраты: "Если (Tz)=0, то ..."
    m = u.match(/^ЕСЛИ\s*\(\s*(T[ZCSP])\s*\)\s*=\s*([01])\s*,?\s*ТО\s*(.+)$/);
    if (m) {
      const flag = m[1], val = m[2], body = m[3].trim();
      const mapCond = {
        'TZ=0': 'NZ', 'TZ=1': 'Z', 'TC=0': 'NC', 'TC=1': 'C',
        'TP=0': 'PO', 'TP=1': 'PE', 'TS=0': 'P', 'TS=1': 'M'
      };
      const suf = mapCond[`${flag}=${val}`];
      if (!suf) return fail('Неизвестный флаг условия');
      if (/PC\s*←\s*\[\(?SP\)?\]/.test(body)) return parseMnemonic('R' + suf);
      const callAddr = body.match(/(?:ВЫЗОВ|PC\s*←)\s*<([0-9A-FH$X]+)>/);
      if (callAddr) {
        const w = parseNumber(callAddr[1], 16);
        if (w !== null) {
          const isCall = /ВЫЗОВ|\[\(SP\)-1\]/.test(body);
          return parseMnemonic((isCall ? 'C' : 'J') + suf + ' ' + fmtWordHex(w));
        }
      }
      return fail('Укажите адрес <XXXXh> или возврат [(SP)]');
    }

    // Безусловный RET, CALL, RST, JMP
    if (/^PC\s*←\s*\[\(?SP\)?\]/.test(u)) return parseMnemonic('RET');
    m = u.match(/\[\(?SP\)?-1\].*PC\s*←\s*<?([0-9A-FH$X]+)>?$/);
    if (m) {
      const w = parseNumber(m[1], 16);
      if (w !== null) {
        if (w <= 0x38 && w % 8 === 0 && /0000/.test(m[1]) && m[1].length >= 4) {
          return parseMnemonic(`RST ${w / 8}`);
        }
        return parseMnemonic(`CALL ${fmtWordHex(w)}`);
      }
    }
    m = u.match(/^PC\s*←\s*<([0-9A-FH$X]+)>$/);
    if (m) {
      const w = parseNumber(m[1], 16);
      if (w !== null) return parseMnemonic(`JMP ${fmtWordHex(w)}`);
    }

    // Стек PUSH / POP
    m = u.match(/^\[?SP\s*-\s*1\]?\s*←\s*\(([BDHA])\)\s*;?\s*\[?SP\s*-\s*2\]?\s*←\s*\(([CELF])\)/);
    if (m) {
      if (m[1] === 'A' && m[2] === 'F') return parseMnemonic('PUSH PSW');
      if (m[1] === 'B' && m[2] === 'C') return parseMnemonic('PUSH B');
      if (m[1] === 'D' && m[2] === 'E') return parseMnemonic('PUSH D');
      if (m[1] === 'H' && m[2] === 'L') return parseMnemonic('PUSH H');
    }
    m = u.match(/^([CELF])\s*←\s*\[SP\]\s*;?\s*([BDHA])\s*←\s*\[SP\s*\+\s*1\]/);
    if (m) {
      if (m[1] === 'F' && m[2] === 'A') return parseMnemonic('POP PSW');
      if (m[1] === 'C' && m[2] === 'B') return parseMnemonic('POP B');
      if (m[1] === 'E' && m[2] === 'D') return parseMnemonic('POP D');
      if (m[1] === 'L' && m[2] === 'H') return parseMnemonic('POP H');
    }

    // SHLD / LHLD / STA / LDA / STAX / LDAX
    m = u.match(/^\[\(?(BC|DE)\)?\]\s*←\s*\(A\)$/);
    if (m) return parseMnemonic(`STAX ${m[1][0]}`);
    m = u.match(/^A\s*←\s*\[\(?(BC|DE)\)?\]$/);
    if (m) return parseMnemonic(`LDAX ${m[1][0]}`);

    m = u.match(/^\[<([0-9A-FH$X]+)>\]\s*←\s*\(L\)\s*;/);
    if (m) {
      const w = parseNumber(m[1], 16);
      if (w !== null) return parseMnemonic(`SHLD ${fmtWordHex(w)}`);
    }
    m = u.match(/^L\s*←\s*\[<([0-9A-FH$X]+)>\]\s*;/);
    if (m) {
      const w = parseNumber(m[1], 16);
      if (w !== null) return parseMnemonic(`LHLD ${fmtWordHex(w)}`);
    }
    m = u.match(/^\[<([0-9A-FH$X]+)>\]\s*←\s*\(A\)$/);
    if (m) {
      const w = parseNumber(m[1], 16);
      if (w !== null) return parseMnemonic(`STA ${fmtWordHex(w)}`);
    }
    m = u.match(/^A\s*←\s*\[<([0-9A-FH$X]+)>\]$/);
    if (m) {
      const w = parseNumber(m[1], 16);
      if (w !== null) return parseMnemonic(`LDA ${fmtWordHex(w)}`);
    }

    // LXI (две формы: "B ← <12h>; C ← <34h>" и "BC ← <1234h>" / "SP ← <1234h>")
    m = u.match(/^([BDH])\s*←\s*<([0-9A-FH$X]+)>\s*;\s*([CEL])\s*←\s*<([0-9A-FH$X]+)>$/);
    if (m) {
      const hi = parseNumber(m[2], 8), lo = parseNumber(m[4], 8);
      if (hi !== null && lo !== null) {
        return parseMnemonic(`LXI ${m[1]}, ${fmtWordHex((hi << 8) | lo)}`);
      }
    }
    m = u.match(/^(BC|DE|HL|SP)\s*←\s*\[?<([0-9A-FH$X]+)>\]?$/);
    if (m) {
      const w = parseNumber(m[2], 16);
      if (w !== null) return parseMnemonic(`LXI ${m[1]}, ${fmtWordHex(w)}`);
    }

    // DAD
    m = u.match(/^HL\s*←\s*\(HL\)\s*\+\s*\((BC|DE|HL|SP|B|D|H)\)$/);
    if (m) return parseMnemonic(`DAD ${m[1]}`);

    // INX / DCX
    m = u.match(/^(BC|DE|HL|SP)\s*←\s*\((BC|DE|HL|SP)\)\s*([+-])\s*1$/);
    if (m && m[1] === m[2]) return parseMnemonic(`${m[3] === '+' ? 'INX' : 'DCX'} ${m[1]}`);

    // INR / DCR
    m = u.match(/^([ABCDEHLM])\s*←\s*\(([ABCDEHLM])\)\s*([+-])\s*1$/);
    if (m && m[1] === m[2]) return parseMnemonic(`${m[3] === '+' ? 'INR' : 'DCR'} ${m[1]}`);

    // Сравнение CMP / CPI: "(A) - (r)" или "(A) - <B2>"
    m = u.match(/^\(A\)\s*-\s*\(([ABCDEHLM])\)\s*(?:СРАВНЕНИЕ)?$/);
    if (m) return parseMnemonic(`CMP ${m[1]}`);
    m = u.match(/^\(A\)\s*-\s*<([0-9A-FH$X]+)>\s*(?:СРАВНЕНИЕ)?$/);
    if (m) {
      const b = parseNumber(m[1], 8);
      if (b !== null) return parseMnemonic(`CPI ${fmtByteHex(b)}`);
    }

    // АЛУ с аккумулятором (3-операндные ADC/ACI/SBB/SBI и 2-операндные ADD..ORI)
    m = u.match(/^A\s*←\s*\(A\)\s*([+-])\s*\(([ABCDEHLM])\)\s*\+\s*\(TC\)$/);
    if (m && m[1] === '+') return parseMnemonic(`ADC ${m[2]}`);
    m = u.match(/^A\s*←\s*\(A\)\s*-\s*\(([ABCDEHLM])\)\s*-\s*\(TC\)$/);
    if (m) return parseMnemonic(`SBB ${m[1]}`);
    m = u.match(/^A\s*←\s*\(A\)\s*\+\s*<([0-9A-FH$X]+)>\s*\+\s*\(TC\)$/);
    if (m) {
      const b = parseNumber(m[1], 8);
      if (b !== null) return parseMnemonic(`ACI ${fmtByteHex(b)}`);
    }
    m = u.match(/^A\s*←\s*\(A\)\s*-\s*<([0-9A-FH$X]+)>\s*-\s*\(TC\)$/);
    if (m) {
      const b = parseNumber(m[1], 8);
      if (b !== null) return parseMnemonic(`SBI ${fmtByteHex(b)}`);
    }

    // Двухоперандное АЛУ с регистром
    m = u.match(/^A\s*←\s*\(A\)\s*([+\-∧∨⊕∀⊻&|^]|OR|XOR|AND)\s*\(([ABCDEHLM])\)$/);
    if (m) {
      const sym = m[1], r = m[2];
      if (sym === '+') return parseMnemonic(`ADD ${r}`);
      if (sym === '-') return parseMnemonic(`SUB ${r}`);
      if (sym === '∧' || sym === '&' || sym === 'AND') return parseMnemonic(`ANA ${r}`);
      if (sym === '∨' || sym === '|' || sym === 'OR') return parseMnemonic(`ORA ${r}`);
      return parseMnemonic(`XRA ${r}`);
    }

    // Двухоперандное АЛУ с непосредственным значением
    m = u.match(/^A\s*←\s*\(A\)\s*([+\-∧∨⊕∀⊻&|^]|OR|XOR|AND)\s*<?([0-9A-FH$X]+)>?$/);
    if (m) {
      const sym = m[1], imm = parseNumber(m[2], 8);
      if (imm !== null) {
        const h = fmtByteHex(imm);
        if (sym === '+') return parseMnemonic(`ADI ${h}`);
        if (sym === '-') return parseMnemonic(`SUI ${h}`);
        if (sym === '∧' || sym === '&' || sym === 'AND') return parseMnemonic(`ANI ${h}`);
        if (sym === '∨' || sym === '|' || sym === 'OR') return parseMnemonic(`ORI ${h}`);
        return parseMnemonic(`XRI ${h}`);
      }
    }

    // MOV: r1 ← (r2)
    m = u.match(/^([ABCDEHLM])\s*←\s*\(([ABCDEHLM])\)$/);
    if (m) return parseMnemonic(`MOV ${m[1]}, ${m[2]}`);

    // MVI: r1 ← <imm8>
    m = u.match(/^([ABCDEHLM])\s*←\s*<?([0-9A-FH$X]+)>?$/);
    if (m) {
      const imm = parseNumber(m[2], 8);
      if (imm !== null) return parseMnemonic(`MVI ${m[1]}, ${fmtByteHex(imm)}`);
    }

    return fail('Не удалось распознать содержание (пример: A ← (A) ∨ (C) или B ← <43h>)');
  }

  return {
    REG_CODE,
    CODE_REG,
    fmtByteHex,
    fmtWordHex,
    fmtBinGrouped,
    parseNumber,
    parseMnemonic,
    parseContent
  };
})();