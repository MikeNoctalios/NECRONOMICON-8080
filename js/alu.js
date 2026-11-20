window.NecroALU = (function () {
  function hex2(n) {
    return ((n & 0xff) >>> 0).toString(16).toUpperCase().padStart(2, '0') + 'h';
  }

  function hex4(n) {
    return ((n & 0xffff) >>> 0).toString(16).toUpperCase().padStart(4, '0') + 'h';
  }

  function bin8(n) {
    return ((n & 0xff) >>> 0).toString(2).padStart(8, '0');
  }

  function bin8Grouped(n) {
    const b = bin8(n);
    return b.slice(0, 2) + ' ' + b.slice(2, 5) + ' ' + b.slice(5);
  }

  function parityEven(byte) {
    let v = byte & 0xff;
    let ones = 0;
    for (let i = 0; i < 8; i++) {
      if ((v >> i) & 1) ones++;
    }
    return ones % 2 === 0 ? 1 : 0;
  }

  function updateZSP(flags, res8) {
    const r = res8 & 0xff;
    flags.Tz = r === 0 ? 1 : 0;
    flags.Ts = (r & 0x80) !== 0 ? 1 : 0;
    flags.Tp = parityEven(r);
  }

  function packPSW(flags) {
    return (
      ((flags.Ts & 1) << 7) |
      ((flags.Tz & 1) << 6) |
      ((flags.Tv & 1) << 4) |
      ((flags.Tp & 1) << 2) |
      0x02 |
      (flags.Tc & 1)
    );
  }

  function unpackPSW(fByte) {
    return {
      Tz: (fByte >> 6) & 1,
      Ts: (fByte >> 7) & 1,
      Tc: fByte & 1,
      Tv: (fByte >> 4) & 1,
      Tp: (fByte >> 2) & 1
    };
  }

  function aluAdd(a, b, carryIn, flags) {
    const sum = a + b + carryIn;
    const res = sum & 0xff;
    flags.Tc = sum > 0xff ? 1 : 0;
    flags.Tv = (a & 0x0f) + (b & 0x0f) + carryIn > 0x0f ? 1 : 0;
    updateZSP(flags, res);
    return res;
  }

  function aluSub(a, b, borrowIn, flags) {
    const diff = a - b - borrowIn;
    const res = diff & 0xff;
    flags.Tc = diff < 0 ? 1 : 0;
    // В i8080/КР580ВМ80А Tv при вычитании выставляется по сложению с доп. кодом
    flags.Tv = (a & 0x0f) + ((~b) & 0x0f) + (1 - borrowIn) > 0x0f ? 1 : 0;
    updateZSP(flags, res);
    return res;
  }

  function aluLogic(op, a, b, flags) {
    let res = a;
    if (op === 'AND') {
      res = a & b;
      flags.Tc = 0;
      flags.Tv = 0; // По таблице справочника КР580ВМ80А
    } else if (op === 'XOR') {
      res = a ^ b;
      flags.Tc = 0;
      flags.Tv = 0;
    } else if (op === 'OR') {
      res = a | b;
      flags.Tc = 0;
      flags.Tv = 0;
    }
    updateZSP(flags, res);
    return res & 0xff;
  }

  function aluInr(val, flags) {
    const res = (val + 1) & 0xff;
    flags.Tv = (val & 0x0f) === 0x0f ? 1 : 0;
    updateZSP(flags, res);
    return res;
  }

  function aluDcr(val, flags) {
    const res = (val - 1) & 0xff;
    flags.Tv = (val & 0x0f) !== 0 ? 1 : 0;
    updateZSP(flags, res);
    return res;
  }

  function aluDaa(a, flags) {
    let val = a & 0xff;
    let add = 0;
    let c = flags.Tc;
    if ((val & 0x0f) > 9 || flags.Tv === 1) {
      add |= 0x06;
      flags.Tv = (val & 0x0f) + 6 > 0x0f ? 1 : 0;
    } else {
      flags.Tv = 0;
    }
    if ((val >> 4) > 9 || c === 1 || ((val >> 4) >= 9 && (val & 0x0f) > 9)) {
      add |= 0x60;
      c = 1;
    }
    const res = (val + add) & 0xff;
    flags.Tc = c;
    updateZSP(flags, res);
    return res;
  }

  function aluRotate(op, a, flags) {
    let res = a & 0xff;
    const oldTc = flags.Tc & 1;
    if (op === 'RLC') {
      const bit7 = (res >> 7) & 1;
      res = ((res << 1) | bit7) & 0xff;
      flags.Tc = bit7;
    } else if (op === 'RRC') {
      const bit0 = res & 1;
      res = ((res >> 1) | (bit0 << 7)) & 0xff;
      flags.Tc = bit0;
    } else if (op === 'RAL') {
      const bit7 = (res >> 7) & 1;
      res = ((res << 1) | oldTc) & 0xff;
      flags.Tc = bit7;
    } else if (op === 'RAR') {
      const bit0 = res & 1;
      res = ((res >> 1) | (oldTc << 7)) & 0xff;
      flags.Tc = bit0;
    }
    return res;
  }

  function checkCondition(cond, flags) {
    if (!cond) return true;
    return flags[cond.flag] === cond.val;
  }

  function createDefaultState() {
    return {
      A: 0, B: 0, C: 0, D: 0, E: 0, H: 0, L: 0, M: 0,
      SP: 0x2000,
      PC: 0x75b6,
      flags: { Tz: 0, Ts: 0, Tc: 0, Tv: 0, Tp: 0 },
      halted: false,
      inte: false,
      log: []
    };
  }

  // Выполнение одной распарсенной команды в эмуляторе программы
  function stepParsed(state, parsed, byteLength) {
    const f = state.flags;
    const op = parsed.op;
    const arg1 = parsed.arg1;
    const arg2 = parsed.arg2;

    const getReg = r => (r === 'M' ? state.M : state[r]);
    const setReg = (r, val) => {
      const v = val & 0xff;
      if (r === 'M') state.M = v;
      else state[r] = v;
    };
    const getPair = rp => {
      if (rp === 'BC' || rp === 'B') return (state.B << 8) | state.C;
      if (rp === 'DE' || rp === 'D') return (state.D << 8) | state.E;
      if (rp === 'HL' || rp === 'H') return (state.H << 8) | state.L;
      if (rp === 'SP') return state.SP;
      if (rp === 'PSW') return (state.A << 8) | packPSW(f);
      return 0;
    };
    const setPair = (rp, val) => {
      const w = val & 0xffff;
      if (rp === 'BC' || rp === 'B') { state.B = (w >> 8) & 0xff; state.C = w & 0xff; }
      else if (rp === 'DE' || rp === 'D') { state.D = (w >> 8) & 0xff; state.E = w & 0xff; }
      else if (rp === 'HL' || rp === 'H') { state.H = (w >> 8) & 0xff; state.L = w & 0xff; }
      else if (rp === 'SP') { state.SP = w; }
      else if (rp === 'PSW') { state.A = (w >> 8) & 0xff; state.flags = unpackPSW(w & 0xff); }
    };

    let note = '';
    switch (op) {
      case 'MOV': setReg(arg1, getReg(arg2)); note = `${arg1} = ${hex2(getReg(arg1))}`; break;
      case 'MVI': setReg(arg1, arg2); note = `${arg1} = ${hex2(arg2)}`; break;
      case 'LXI': setPair(arg1, arg2); note = `${arg1} = ${hex4(arg2)}`; break;
      case 'STAX': case 'LDAX': case 'STA': case 'LDA': case 'SHLD': case 'LHLD':
        note = 'Операция с внешней ячейкой памяти'; break;
      case 'PUSH': state.SP = (state.SP - 2) & 0xffff; note = `Стек ← ${arg1}, SP=${hex4(state.SP)}`; break;
      case 'POP': state.SP = (state.SP + 2) & 0xffff; note = `${arg1} ← Стек, SP=${hex4(state.SP)}`; break;
      case 'XCHG': {
        const tmpH = state.H, tmpL = state.L;
        state.H = state.D; state.L = state.E; state.D = tmpH; state.E = tmpL;
        note = `DE=${hex4(getPair('DE'))}, HL=${hex4(getPair('HL'))}`;
        break;
      }
      case 'XTHL': note = 'Обмен HL с вершиной стека'; break;
      case 'SPHL': state.SP = getPair('HL'); note = `SP=${hex4(state.SP)}`; break;
      case 'PCHL': state.PC = getPair('HL'); note = `PC=${hex4(state.PC)}`; return note;
      case 'INR': setReg(arg1, aluInr(getReg(arg1), f)); note = `${arg1}=${hex2(getReg(arg1))}`; break;
      case 'DCR': setReg(arg1, aluDcr(getReg(arg1), f)); note = `${arg1}=${hex2(getReg(arg1))}`; break;
      case 'INX': setPair(arg1, getPair(arg1) + 1); note = `${arg1}=${hex4(getPair(arg1))}`; break;
      case 'DCX': setPair(arg1, getPair(arg1) - 1); note = `${arg1}=${hex4(getPair(arg1))}`; break;
      case 'DAD': {
        const sum = getPair('HL') + getPair(arg1);
        f.Tc = sum > 0xffff ? 1 : 0;
        setPair('HL', sum);
        note = `HL=${hex4(getPair('HL'))}, Tc=${f.Tc}`;
        break;
      }
      case 'ADD': state.A = aluAdd(state.A, getReg(arg1), 0, f); note = `A=${hex2(state.A)}`; break;
      case 'ADC': state.A = aluAdd(state.A, getReg(arg1), f.Tc, f); note = `A=${hex2(state.A)}`; break;
      case 'SUB': state.A = aluSub(state.A, getReg(arg1), 0, f); note = `A=${hex2(state.A)}`; break;
      case 'SBB': state.A = aluSub(state.A, getReg(arg1), f.Tc, f); note = `A=${hex2(state.A)}`; break;
      case 'ANA': state.A = aluLogic('AND', state.A, getReg(arg1), f); note = `A=${hex2(state.A)}`; break;
      case 'XRA': state.A = aluLogic('XOR', state.A, getReg(arg1), f); note = `A=${hex2(state.A)}`; break;
      case 'ORA': state.A = aluLogic('OR', state.A, getReg(arg1), f); note = `A=${hex2(state.A)}`; break;
      case 'CMP': aluSub(state.A, getReg(arg1), 0, f); note = `Сравнение A=${hex2(state.A)}`; break;
      case 'ADI': state.A = aluAdd(state.A, arg1, 0, f); note = `A=${hex2(state.A)}`; break;
      case 'ACI': state.A = aluAdd(state.A, arg1, f.Tc, f); note = `A=${hex2(state.A)}`; break;
      case 'SUI': state.A = aluSub(state.A, arg1, 0, f); note = `A=${hex2(state.A)}`; break;
      case 'SBI': state.A = aluSub(state.A, arg1, f.Tc, f); note = `A=${hex2(state.A)}`; break;
      case 'ANI': state.A = aluLogic('AND', state.A, arg1, f); note = `A=${hex2(state.A)}`; break;
      case 'XRI': state.A = aluLogic('XOR', state.A, arg1, f); note = `A=${hex2(state.A)}`; break;
      case 'ORI': state.A = aluLogic('OR', state.A, arg1, f); note = `A=${hex2(state.A)}`; break;
      case 'CPI': aluSub(state.A, arg1, 0, f); note = `Сравнение с ${hex2(arg1)}`; break;
      case 'RLC': case 'RRC': case 'RAL': case 'RAR':
        state.A = aluRotate(op, state.A, f);
        note = `A=${hex2(state.A)}, Tc=${f.Tc}`;
        break;
      case 'CMA': state.A = (~state.A) & 0xff; note = `A=${hex2(state.A)}`; break;
      case 'STC': f.Tc = 1; note = 'Tc=1'; break;
      case 'CMC': f.Tc = f.Tc ? 0 : 1; note = `Tc=${f.Tc}`; break;
      case 'DAA': state.A = aluDaa(state.A, f); note = `A=${hex2(state.A)} (BCD)`; break;
      case 'EI': state.inte = true; note = 'INTE=1'; break;
      case 'DI': state.inte = false; note = 'INTE=0'; break;
      case 'HLT': state.halted = true; note = 'Останов'; break;
      case 'NOP': note = 'Пропуск тактов'; break;
      default: note = 'Выполнено'; break;
    }
    state.PC = (state.PC + byteLength) & 0xffff;
    return note;
  }

  return {
    hex2,
    hex4,
    bin8,
    bin8Grouped,
    parityEven,
    updateZSP,
    packPSW,
    unpackPSW,
    aluAdd,
    aluSub,
    aluLogic,
    aluInr,
    aluDcr,
    aluDaa,
    aluRotate,
    checkCondition,
    createDefaultState,
    stepParsed
  };
})();