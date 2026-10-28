import { describe, expect, it } from "vite-plus/test";

import { maskCpf, maskPhone } from "./masks";

describe("signup masks", () => {
  it("formats a CPF progressively and idempotently", () => {
    expect(maskCpf("529")).toBe("529");
    expect(maskCpf("5299")).toBe("529.9");
    expect(maskCpf("5299822")).toBe("529.982.2");
    expect(maskCpf("52998224724")).toBe("529.982.247-24");
    expect(maskCpf("529.982.247-24")).toBe("529.982.247-24");
    expect(maskCpf("529.982.247-245")).toBe("529.982.247-24");
  });

  it("formats landline and mobile numbers", () => {
    expect(maskPhone("1")).toBe("(1");
    expect(maskPhone("119")).toBe("(11) 9");
    expect(maskPhone("1187654321")).toBe("(11) 8765-4321");
    expect(maskPhone("11987654321")).toBe("(11) 98765-4321");
    expect(maskPhone("(11) 98765-4321")).toBe("(11) 98765-4321");
  });

  it("drops a pasted country code or trunk prefix", () => {
    expect(maskPhone("+55 11 98765-4321")).toBe("(11) 98765-4321");
    expect(maskPhone("5511987654321")).toBe("(11) 98765-4321");
    expect(maskPhone("011 98765-4321")).toBe("(11) 98765-4321");
    // Typing past 11 digits that start with 55 re-reads them as country code + number.
    expect(maskPhone("(55) 11987-654321")).toBe("(11) 98765-4321");
  });
});
