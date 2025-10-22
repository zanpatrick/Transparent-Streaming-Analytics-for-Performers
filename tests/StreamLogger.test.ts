import { describe, it, expect, beforeEach } from "vitest";
import { buffCV, optionalCV, principalCV, uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_CONTENT_ID = 101;
const ERR_INVALID_PERFORMER_ID = 102;
const ERR_INVALID_GEO_REGION = 104;
const ERR_INVALID_DEVICE_TYPE = 105;
const ERR_INVALID_TIMESTAMP = 106;
const ERR_INVALID_ORACLE_SIGNATURE = 107;
const ERR_RATE_LIMIT_EXCEEDED = 108;
const ERR_MAX_STREAMS_EXCEEDED = 118;
const ERR_AUTHORITY_NOT_VERIFIED = 113;
const ERR_INVALID_ENGAGEMENT_TYPE = 119;
const ERR_INVALID_DURATION = 120;
const ERR_INVALID_LOG_FEE = 115;
const ERR_STREAM_NOT_FOUND = 110;
const ERR_INVALID_BATCH_SIZE = 111;

interface Stream {
  contentId: number;
  performerId: string;
  listenerId: string | null;
  geoRegion: number;
  deviceType: number;
  timestamp: number;
  engagementType: number;
  duration: number;
  oracleSignature: Buffer;
  status: boolean;
}

interface StreamUpdate {
  updateTimestamp: number;
  updateDuration: number;
  updater: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class StreamLoggerMock {
  state: {
    nextStreamId: number;
    maxStreams: number;
    logFee: number;
    authorityContract: string | null;
    oraclePublicKey: Buffer;
    streamEvents: Map<number, Stream>;
    streamCountsByContent: Map<number, number>;
    streamsByTimestamp: Map<string, number[]>;
    streamUpdates: Map<number, StreamUpdate>;
  } = {
    nextStreamId: 0,
    maxStreams: 1000000,
    logFee: 10,
    authorityContract: null,
    oraclePublicKey: Buffer.alloc(33, 0),
    streamEvents: new Map(),
    streamCountsByContent: new Map(),
    streamsByTimestamp: new Map(),
    streamUpdates: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextStreamId: 0,
      maxStreams: 1000000,
      logFee: 10,
      authorityContract: null,
      oraclePublicKey: Buffer.alloc(33, 0),
      streamEvents: new Map(),
      streamCountsByContent: new Map(),
      streamsByTimestamp: new Map(),
      streamUpdates: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.stxTransfers = [];
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (this.state.authorityContract !== null) {
      return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setOraclePublicKey(pubkey: Buffer): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };
    if (this.caller !== this.state.authorityContract) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.oraclePublicKey = pubkey;
    return { ok: true, value: true };
  }

  setLogFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };
    if (newFee < 0) return { ok: false, value: ERR_INVALID_LOG_FEE };
    this.state.logFee = newFee;
    return { ok: true, value: true };
  }

  setMaxStreams(newMax: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };
    if (newMax <= 0) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.maxStreams = newMax;
    return { ok: true, value: true };
  }

  logStream(
    contentId: number,
    performerId: string,
    listenerId: string | null,
    geoRegion: number,
    deviceType: number,
    timestamp: number,
    engagementType: number,
    duration: number,
    oracleSignature: Buffer
  ): Result<number> {
    if (this.state.nextStreamId >= this.state.maxStreams) return { ok: false, value: ERR_MAX_STREAMS_EXCEEDED };
    if (contentId <= 0) return { ok: false, value: ERR_INVALID_CONTENT_ID };
    if (performerId === "SP000000000000000000002Q6VF78") return { ok: false, value: ERR_INVALID_PERFORMER_ID };
    if (geoRegion > 1000) return { ok: false, value: ERR_INVALID_GEO_REGION };
    if (deviceType > 10) return { ok: false, value: ERR_INVALID_DEVICE_TYPE };
    if (timestamp < this.blockHeight || timestamp > this.blockHeight + 144) return { ok: false, value: ERR_INVALID_TIMESTAMP };
    if (engagementType > 5) return { ok: false, value: ERR_INVALID_ENGAGEMENT_TYPE };
    if (duration <= 0 || duration > 3600) return { ok: false, value: ERR_INVALID_DURATION };
    const message = Buffer.concat([Buffer.from(contentId.toString()), Buffer.from(performerId), Buffer.from(timestamp.toString())]);
    const hash = this.sha256(message);
    if (!this.secp256k1Verify(hash, oracleSignature, this.state.oraclePublicKey)) return { ok: false, value: ERR_INVALID_ORACLE_SIGNATURE };
    const count = this.state.streamCountsByContent.get(contentId) || 0;
    if (count >= 10000) return { ok: false, value: ERR_RATE_LIMIT_EXCEEDED };
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };

    this.stxTransfers.push({ amount: this.state.logFee, from: this.caller, to: this.state.authorityContract });

    const id = this.state.nextStreamId;
    const stream: Stream = {
      contentId,
      performerId,
      listenerId,
      geoRegion,
      deviceType,
      timestamp,
      engagementType,
      duration,
      oracleSignature,
      status: true,
    };
    this.state.streamEvents.set(id, stream);
    this.state.streamCountsByContent.set(contentId, count + 1);
    const key = `${contentId}-${timestamp}`;
    const list = this.state.streamsByTimestamp.get(key) || [];
    list.push(id);
    if (list.length > 100) list.shift();
    this.state.streamsByTimestamp.set(key, list);
    this.state.nextStreamId++;
    return { ok: true, value: id };
  }

  getStream(id: number): Stream | null {
    return this.state.streamEvents.get(id) || null;
  }

  getStreamCount(contentId: number): number {
    return this.state.streamCountsByContent.get(contentId) || 0;
  }

  updateStreamDuration(id: number, newDuration: number): Result<boolean> {
    const stream = this.state.streamEvents.get(id);
    if (!stream) return { ok: false, value: ERR_STREAM_NOT_FOUND };
    if (stream.performerId !== this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (newDuration <= 0 || newDuration > 3600) return { ok: false, value: ERR_INVALID_DURATION };
    const updated: Stream = { ...stream, duration: newDuration };
    this.state.streamEvents.set(id, updated);
    this.state.streamUpdates.set(id, {
      updateTimestamp: this.blockHeight,
      updateDuration: newDuration,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }

  verifyStreamBatch(ids: number[]): Result<boolean> {
    return ids.reduce((acc: Result<boolean>, id: number) => {
      if (!acc.ok) return acc;
      const stream = this.getStream(id);
      return stream ? { ok: true, value: acc.value && stream.status } : { ok: true, value: acc.value };
    }, { ok: true, value: true });
  }

  getTotalStreams(): Result<number> {
    return { ok: true, value: this.state.nextStreamId };
  }

  getStreamsInRange(contentId: number, start: number, end: number): number[] {
    let result: number[] = [];
    for (let ts = start; ts <= end; ts++) {
      const key = `${contentId}-${ts}`;
      const list = this.state.streamsByTimestamp.get(key) || [];
      result = result.concat(list);
    }
    return result.slice(0, 100);
  }

  private sha256(message: Buffer): Buffer {
    return crypto.createHash("sha256").update(message).digest();
  }

  private secp256k1Verify(hash: Buffer, sig: Buffer, pubkey: Buffer): boolean {
    return true;
  }
}

import * as crypto from "crypto";

describe("StreamLogger", () => {
  let contract: StreamLoggerMock;

  beforeEach(() => {
    contract = new StreamLoggerMock();
    contract.reset();
  });

  it("logs a stream successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.setOraclePublicKey(Buffer.alloc(33, 1));
    const sig = Buffer.alloc(65, 1);
    const result = contract.logStream(1, "ST3PERF", null, 100, 1, 10, 1, 300, sig);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const stream = contract.getStream(0);
    expect(stream?.contentId).toBe(1);
    expect(stream?.performerId).toBe("ST3PERF");
    expect(stream?.geoRegion).toBe(100);
    expect(stream?.deviceType).toBe(1);
    expect(stream?.timestamp).toBe(10);
    expect(stream?.engagementType).toBe(1);
    expect(stream?.duration).toBe(300);
    expect(stream?.status).toBe(true);
    expect(contract.stxTransfers).toEqual([{ amount: 10, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects log without authority", () => {
    const sig = Buffer.alloc(65, 1);
    const result = contract.logStream(1, "ST3PERF", null, 100, 1, 10, 1, 300, sig);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_VERIFIED);
  });

  it("rejects invalid content id", () => {
    contract.setAuthorityContract("ST2TEST");
    const sig = Buffer.alloc(65, 1);
    const result = contract.logStream(0, "ST3PERF", null, 100, 1, 10, 1, 300, sig);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CONTENT_ID);
  });

  it("rejects invalid timestamp", () => {
    contract.setAuthorityContract("ST2TEST");
    const sig = Buffer.alloc(65, 1);
    const result = contract.logStream(1, "ST3PERF", null, 100, 1, 200, 1, 300, sig);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TIMESTAMP);
  });

  it("rejects rate limit exceeded", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.streamCountsByContent.set(1, 10000);
    const sig = Buffer.alloc(65, 1);
    const result = contract.logStream(1, "ST3PERF", null, 100, 1, 10, 1, 300, sig);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_RATE_LIMIT_EXCEEDED);
  });

  it("updates stream duration successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const sig = Buffer.alloc(65, 1);
    contract.logStream(1, "ST1TEST", null, 100, 1, 10, 1, 300, sig);
    const result = contract.updateStreamDuration(0, 400);
    expect(result.ok).toBe(true);
    const stream = contract.getStream(0);
    expect(stream?.duration).toBe(400);
    const update = contract.state.streamUpdates.get(0);
    expect(update?.updateDuration).toBe(400);
    expect(update?.updater).toBe("ST1TEST");
  });

  it("rejects update by non-performer", () => {
    contract.setAuthorityContract("ST2TEST");
    const sig = Buffer.alloc(65, 1);
    contract.logStream(1, "ST3PERF", null, 100, 1, 10, 1, 300, sig);
    contract.caller = "ST4OTHER";
    const result = contract.updateStreamDuration(0, 400);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("verifies stream batch successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const sig = Buffer.alloc(65, 1);
    contract.logStream(1, "ST3PERF", null, 100, 1, 10, 1, 300, sig);
    contract.logStream(1, "ST3PERF", null, 100, 1, 11, 1, 300, sig);
    const result = contract.verifyStreamBatch([0, 1]);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
  });

  it("gets streams in range", () => {
    contract.setAuthorityContract("ST2TEST");
    const sig = Buffer.alloc(65, 1);
    contract.logStream(1, "ST3PERF", null, 100, 1, 10, 1, 300, sig);
    contract.logStream(1, "ST3PERF", null, 100, 1, 11, 1, 300, sig);
    const result = contract.getStreamsInRange(1, 10, 11);
    expect(result).toEqual([0, 1]);
  });

  it("sets log fee successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setLogFee(20);
    expect(result.ok).toBe(true);
    expect(contract.state.logFee).toBe(20);
  });

  it("rejects invalid log fee", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setLogFee(-1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_LOG_FEE);
  });

  it("gets total streams", () => {
    contract.setAuthorityContract("ST2TEST");
    const sig = Buffer.alloc(65, 1);
    contract.logStream(1, "ST3PERF", null, 100, 1, 10, 1, 300, sig);
    const result = contract.getTotalStreams();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1);
  });

  it("rejects max streams exceeded", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.maxStreams = 0;
    const sig = Buffer.alloc(65, 1);
    const result = contract.logStream(1, "ST3PERF", null, 100, 1, 10, 1, 300, sig);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_STREAMS_EXCEEDED);
  });

  it("sets oracle public key successfully", () => {
    contract.setAuthorityContract("ST1TEST");
    const pubkey = Buffer.alloc(33, 2);
    const result = contract.setOraclePublicKey(pubkey);
    expect(result.ok).toBe(true);
    expect(contract.state.oraclePublicKey).toEqual(pubkey);
  });

  it("rejects oracle key set by non-authority", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.caller = "ST3OTHER";
    const pubkey = Buffer.alloc(33, 2);
    const result = contract.setOraclePublicKey(pubkey);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });
});