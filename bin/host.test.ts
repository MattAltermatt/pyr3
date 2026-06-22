import { describe, it, expect } from 'vitest';
import { patchWindowsNodeImport } from './host';

// #399 — patchWindowsNodeImport rewrites the import-table DLL name of a Windows
// PE `.node` (`node.exe` → the SEA host's basename) so Dawn-node binds its N-API
// imports to the running host instead of a stray node.exe on PATH. The real
// inputs are 30+ MB Dawn binaries on win32-x64 only; these tests exercise the
// parser + both rewrite strategies against a hand-built minimal PE64 so the
// binary surgery has coverage on the platforms CI actually runs.
//
// Minimal PE64 layout (file offsets):
//   0x3C  e_lfanew = 0x40
//   0x40  "PE\0\0"
//   0x44  COFF header (NumberOfSections=1, SizeOfOptionalHeader=240)
//   0x58  Optional header (PE32+ magic, SectionAlignment=0x1000, FileAlignment=0x200,
//         data dir [1] import-table RVA = 0x1000)
//   0x148 one section header (.text: VA 0x1000, raw @ 0x200, sizes 0x200)
//   0x200 import descriptor[0] (Name RVA → 0x1040) + zero terminator descriptor
//   0x240 the import DLL name string (RVA 0x1040)
//   len   0x400

const E_LFANEW = 0x40;
const COFF = E_LFANEW + 4; // 0x44
const OPT = COFF + 20; // 0x58
const OPT_SIZE = 240;
const SEC_HDR = OPT + OPT_SIZE; // 0x148
const IMPORT_RVA = 0x1000;
const SEC_VADDR = 0x1000;
const SEC_PRAW = 0x200;
const SEC_SIZE = 0x200;
const NAME_RVA = 0x1040;
const NAME_FILE = SEC_PRAW + (NAME_RVA - SEC_VADDR); // 0x240

function buildMinimalPE(importName: string): Buffer {
  const buf = Buffer.alloc(0x400);
  buf.writeUInt32LE(E_LFANEW, 0x3c);
  buf.write('PE\0\0', E_LFANEW, 'latin1');

  // COFF header
  buf.writeUInt16LE(0x8664, COFF); // Machine = AMD64
  buf.writeUInt16LE(1, COFF + 2); // NumberOfSections
  buf.writeUInt16LE(OPT_SIZE, COFF + 16); // SizeOfOptionalHeader

  // Optional header (PE32+)
  buf.writeUInt16LE(0x020b, OPT); // Magic = PE32+
  buf.writeUInt32LE(0x1000, OPT + 32); // SectionAlignment
  buf.writeUInt32LE(0x200, OPT + 36); // FileAlignment
  buf.writeUInt32LE(0x2000, OPT + 56); // SizeOfImage (placeholder; append updates it)
  buf.writeUInt32LE(0x200, OPT + 60); // SizeOfHeaders
  buf.writeUInt32LE(16, OPT + 108); // NumberOfRvaAndSizes
  // Data directory [1] = import table; RVA at ddStart+8 = (OPT+112)+8.
  buf.writeUInt32LE(IMPORT_RVA, OPT + 112 + 8);
  buf.writeUInt32LE(40, OPT + 112 + 12); // its Size (two descriptors)

  // Section header (.text)
  buf.write('.text\0\0\0', SEC_HDR, 'latin1');
  buf.writeUInt32LE(SEC_SIZE, SEC_HDR + 8); // VirtualSize
  buf.writeUInt32LE(SEC_VADDR, SEC_HDR + 12); // VirtualAddress
  buf.writeUInt32LE(SEC_SIZE, SEC_HDR + 16); // SizeOfRawData
  buf.writeUInt32LE(SEC_PRAW, SEC_HDR + 20); // PointerToRawData
  buf.writeUInt32LE(0x40000040, SEC_HDR + 36); // MEM_READ | CNT_INITIALIZED_DATA

  // Import descriptor[0]: Name RVA at +12 → the string. Other fields zero.
  buf.writeUInt32LE(NAME_RVA, SEC_PRAW + 12);
  // Descriptor[1] at SEC_PRAW+20 is left zeroed = terminator.
  buf.write(importName + '\0', NAME_FILE, 'latin1');
  return buf;
}

// Mirror the parser to read back the FIRST import descriptor's DLL name, so the
// assertions validate the real on-disk result rather than trusting the writer.
function readFirstImportName(bytes: Buffer): string {
  const eLfanew = bytes.readUInt32LE(0x3c);
  const coff = eLfanew + 4;
  const numSections = bytes.readUInt16LE(coff + 2);
  const optSize = bytes.readUInt16LE(coff + 16);
  const opt = coff + 20;
  const pe32plus = bytes.readUInt16LE(opt) === 0x20b;
  const ddStart = opt + (pe32plus ? 112 : 96);
  const importRva = bytes.readUInt32LE(ddStart + 8);
  const secHdr = opt + optSize;
  const sections: { vaddr: number; vsize: number; praw: number; rsize: number }[] = [];
  for (let i = 0; i < numSections; i++) {
    const o = secHdr + i * 40;
    sections.push({
      vsize: bytes.readUInt32LE(o + 8),
      vaddr: bytes.readUInt32LE(o + 12),
      rsize: bytes.readUInt32LE(o + 16),
      praw: bytes.readUInt32LE(o + 20),
    });
  }
  const rva2off = (rva: number): number => {
    for (const s of sections) {
      if (rva >= s.vaddr && rva < s.vaddr + Math.max(s.vsize, s.rsize)) {
        return s.praw + (rva - s.vaddr);
      }
    }
    return -1;
  };
  const o = rva2off(importRva);
  const nameRva = bytes.readUInt32LE(o + 12);
  const off = rva2off(nameRva);
  let e = off;
  while (bytes[e]) e++;
  return bytes.toString('latin1', off, e);
}

function sectionNames(bytes: Buffer): string[] {
  const eLfanew = bytes.readUInt32LE(0x3c);
  const coff = eLfanew + 4;
  const numSections = bytes.readUInt16LE(coff + 2);
  const optSize = bytes.readUInt16LE(coff + 16);
  const secHdr = coff + 20 + optSize;
  const names: string[] = [];
  for (let i = 0; i < numSections; i++) {
    const o = secHdr + i * 40;
    names.push(bytes.toString('latin1', o, o + 8).replace(/\0+$/, ''));
  }
  return names;
}

describe('patchWindowsNodeImport (#399)', () => {
  it('sanity: the fixture builder produces a parseable node.exe import', () => {
    expect(readFirstImportName(buildMinimalPE('node.exe'))).toBe('node.exe');
  });

  it('in-place rewrite when the new name fits the node.exe slot (+ NUL)', () => {
    const pe = buildMinimalPE('node.exe');
    const out = patchWindowsNodeImport(pe, 'py.exe'); // 6 < 8 → fits in place
    expect(out).toBe(pe); // same buffer, mutated in place
    expect(out.length).toBe(0x400); // no growth
    expect(readFirstImportName(out)).toBe('py.exe');
    expect(sectionNames(out)).toEqual(['.text']); // no new section
  });

  it('appends a new section when the new name is longer than the slot', () => {
    const pe = buildMinimalPE('node.exe');
    const out = patchWindowsNodeImport(pe, 'pyr3-render.exe'); // 15 > 8 → append
    expect(out.length).toBeGreaterThan(0x400); // grew
    expect(readFirstImportName(out)).toBe('pyr3-render.exe');
    expect(sectionNames(out)).toEqual(['.text', '.pyr3nm']); // one appended section
    // NumberOfSections bumped to 2.
    const coff = out.readUInt32LE(0x3c) + 4;
    expect(out.readUInt16LE(coff + 2)).toBe(2);
    // SizeOfImage covers the new section's aligned end (0x2000 + name, ↑ to 0x3000).
    const opt = coff + 20;
    expect(out.readUInt32LE(opt + 56)).toBe(0x3000);
  });

  it('is idempotent — re-patching to the current import name returns it unchanged', () => {
    const pe = buildMinimalPE('node.exe');
    expect(patchWindowsNodeImport(pe, 'node.exe')).toBe(pe);
    // And a real rename is stable across a second pass.
    const once = patchWindowsNodeImport(buildMinimalPE('node.exe'), 'pyr3-render.exe');
    const twice = patchWindowsNodeImport(once, 'pyr3-render.exe');
    expect(twice).toBe(once);
    expect(readFirstImportName(twice)).toBe('pyr3-render.exe');
  });

  it('throws on a PE with no node.exe import (a real, loud bug)', () => {
    const pe = buildMinimalPE('other.dll');
    expect(() => patchWindowsNodeImport(pe, 'pyr3-render.exe')).toThrow(/no node\.exe import/);
  });

  it('matches node.exe case-insensitively', () => {
    const pe = buildMinimalPE('NODE.EXE');
    const out = patchWindowsNodeImport(pe, 'py.exe');
    expect(readFirstImportName(out)).toBe('py.exe');
  });
});
