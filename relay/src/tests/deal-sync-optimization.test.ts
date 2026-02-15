
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as registryClient from '../utils/registry-client';
import http from 'http';
import https from 'https';
import { EventEmitter } from 'events';

// Mock dependencies
vi.mock('../utils/registry-client');
vi.mock('http');
vi.mock('https');
vi.mock('../utils/logger', () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    createLogger: () => mockLogger,
    loggers: {
      registry: mockLogger,
      dealSync: mockLogger,
    },
  };
});

// We need to import the module under test AFTER mocking dependencies
// But we also need to modify it to export the function we want to test
// For now, we'll test the public API syncDealsWithIPFS
import { syncDealsWithIPFS } from '../utils/deal-sync';

describe('Deal Sync Optimization', () => {
  let mockRequest: any;
  let mockResponse: any;

  beforeEach(() => {
    vi.resetAllMocks();

    // Mock http.request
    mockRequest = {
      on: vi.fn(),
      end: vi.fn(),
      setTimeout: vi.fn(),
      destroy: vi.fn(),
    };

    mockResponse = new EventEmitter();
    (mockResponse as any).statusCode = 200;

    (http.request as any).mockImplementation((options: any, callback: any) => {
      callback(mockResponse);
      return mockRequest;
    });

    (https.request as any).mockImplementation((options: any, callback: any) => {
      callback(mockResponse);
      return mockRequest;
    });
  });

  it('should batch IPFS pin checks', async () => {
    // Setup 3 active deals
    const mockDeals = [
      { dealId: '1', cid: 'QmHash1', active: true, expiresAt: new Date(Date.now() + 10000).toISOString() },
      { dealId: '2', cid: 'QmHash2', active: true, expiresAt: new Date(Date.now() + 10000).toISOString() },
      { dealId: '3', cid: 'QmHash3', active: true, expiresAt: new Date(Date.now() + 10000).toISOString() },
    ];

    // Mock registry client
    (registryClient.createStorageDealRegistryClient as any).mockReturnValue({
      getRelayDeals: vi.fn().mockResolvedValue(mockDeals),
    });

    // Mock IPFS response for "getAllPinnedCids" (batch check)
    // We expect this to be called first
    const batchPinsResponse = {
      Keys: {
        'QmHash1': { Type: 'recursive' },
        'QmHash2': { Type: 'recursive' },
        'QmHash3': { Type: 'recursive' },
      }
    };

    // We need to simulate the response streaming
    // Since we can't easily predict which call is which in the mock implementation without inspecting arguments,
    // we'll inspect the calls AFTER execution to verify behavior.

    // For the purpose of this test running BEFORE the optimization,
    // the code will make individual calls. We'll return "pinned" for all of them.
    // Individual call: /api/v0/pin/ls?arg=QmHash1&type=all
    // Response: { Keys: { QmHash1: ... } }

    (http.request as any).mockImplementation((options: any, callback: any) => {
      callback(mockResponse);

      // Determine what to return based on path
      if (options.path.includes('/api/v0/pin/ls?type=recursive')) {
        // This is the optimized path
        setTimeout(() => {
            mockResponse.emit('data', JSON.stringify(batchPinsResponse));
            mockResponse.emit('end');
        }, 10);
      } else if (options.path.includes('/api/v0/pin/ls?arg=')) {
        // This is the unoptimized path (individual check)
        const cid = options.path.match(/arg=([^&]+)/)[1];
        const response = {
          Keys: {
            [decodeURIComponent(cid)]: { Type: 'recursive' }
          }
        };
        setTimeout(() => {
            mockResponse.emit('data', JSON.stringify(response));
            mockResponse.emit('end');
        }, 10);
      } else {
         setTimeout(() => {
            mockResponse.emit('data', '{}');
            mockResponse.emit('end');
        }, 10);
      }

      return mockRequest;
    });

    await syncDealsWithIPFS('0xRelay', 84532);

    // Verify calls
    const calls = (http.request as any).mock.calls;
    const paths = calls.map((c: any) => c[0].path);

    // Check if we used the batch endpoint
    const usedBatch = paths.some((p: string) => p.includes('type=recursive') && !p.includes('arg='));

    // Check if we used individual endpoints
    const individualCalls = paths.filter((p: string) => p.includes('arg='));

    console.log('HTTP Calls:', paths);

    // Assert based on optimization status (this test is expected to fail initially or show unoptimized behavior)
    // We want 1 batch call and 0 individual calls

    // For reproduction of "issue" (lack of optimization):
    // Expect individualCalls.length to be 3
    // Expect usedBatch to be false
  });
});
