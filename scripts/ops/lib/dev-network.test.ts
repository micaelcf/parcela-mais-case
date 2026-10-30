import { describe, expect, it } from "vite-plus/test";

import { hostGatewayOverride, ipv4BridgeGateway } from "./dev-network";

describe("Docker's host-gateway address", () => {
  it("takes the IPv4 gateway of a dual-stack default bridge, in either order", () => {
    const v4 = { Subnet: "172.17.0.0/16", Gateway: "172.17.0.1" };
    const v6 = { Subnet: "fd00:dead:beef::/48", Gateway: "fd00:dead:beef::1" };
    expect(ipv4BridgeGateway(JSON.stringify([v4, v6]))).toBe("172.17.0.1");
    expect(ipv4BridgeGateway(JSON.stringify([v6, v4]))).toBe("172.17.0.1");
    expect(ipv4BridgeGateway(JSON.stringify([v6]))).toBeNull();
    expect(ipv4BridgeGateway("null")).toBeNull();
    expect(ipv4BridgeGateway("not json")).toBeNull();
  });

  it("follows daemon.json's host-gateway-ips (or host-gateway-ip) over the bridge", () => {
    expect(hostGatewayOverride('{ "host-gateway-ips": ["fd00::1", "10.0.0.5"] }')).toBe("10.0.0.5");
    expect(hostGatewayOverride('{ "host-gateway-ip": "192.168.50.1" }')).toBe("192.168.50.1");
    expect(hostGatewayOverride('{ "dns": ["1.1.1.1"] }')).toBeNull();
    expect(hostGatewayOverride("{ broken")).toBeNull();
  });
});
