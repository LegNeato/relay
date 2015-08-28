/**
 * Copyright 2013-2015, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @emails oncall+relay
 */

'use strict';

var RelayTestUtils = require('RelayTestUtils');
RelayTestUtils.unmockRelay();

jest.dontMock('RelayPendingQueryTracker');

describe('RelayPendingQueryTracker', () => {
  var DliteFetchModeConstants;
  var Relay;
  var RelayPendingQueryTracker;
  var RelayStoreData;

  var addPending;
  var fetchRelayQuery;
  var subtractRelayQuery;
  var writeRelayQueryPayload;

  var {getNode} = RelayTestUtils;

  beforeEach(() => {
    jest.resetModuleRegistry();

    DliteFetchModeConstants = require('DliteFetchModeConstants');
    Relay = require('Relay');
    RelayPendingQueryTracker = require('RelayPendingQueryTracker');
    RelayStoreData = require('RelayStoreData');

    fetchRelayQuery = require('fetchRelayQuery');
    subtractRelayQuery = require('subtractRelayQuery');
    writeRelayQueryPayload = require('writeRelayQueryPayload');

    subtractRelayQuery.mockImplementation(query => query);

    addPending = ({query, fetchMode}) => {
      fetchMode = fetchMode || DliteFetchModeConstants.FETCH_MODE_CLIENT;
      return RelayPendingQueryTracker.add({
        query,
        fetchMode,
        forceIndex: null,
        storeData: RelayStoreData.getDefaultInstance(),
      });
    };

    jest.addMatchers(RelayTestUtils.matchers);
  });

  it('subtracts pending queries that share root call', () => {
    var mockQueryA = getNode(Relay.QL`
      query {
        viewer{actor{id,name}}
      }
    `);
    var mockQueryB = getNode(Relay.QL`
      query {
        node(id:"4"){actor{id,name}}
      }
    `);
    var mockQueryC = getNode(Relay.QL`
      query {
        viewer{actor{id,name,birthdate{day}}}
      }
    `);
    var mockQueryD = getNode(Relay.QL`
      query {
        node(id:"4"){actor{id,name,birthdate{day}}}
      }
    `);

    addPending({query: mockQueryA});
    jest.runAllTimers();

    expect(subtractRelayQuery).not.toBeCalled();

    addPending({query: mockQueryB});
    jest.runAllTimers();

    expect(subtractRelayQuery).not.toBeCalled();

    addPending({query: mockQueryC});
    jest.runAllTimers();

    expect(subtractRelayQuery.mock.calls).toEqual([
      [mockQueryC, mockQueryA],
    ]);

    fetchRelayQuery.mock.requests[1].resolve({});
    jest.runAllTimers();

    subtractRelayQuery.mockClear();
    addPending({query: mockQueryD});
    jest.runAllTimers();

    expect(subtractRelayQuery).not.toBeCalled();
  });

  it('subtracts pending queries until completely subtracted', () => {
    var mockQueryA = getNode(Relay.QL`
      query {
        viewer{actor{id,name}}
      }
    `);
    var mockQueryB = getNode(Relay.QL`
      query {
        viewer{actor{id,name}}
      }
    `);
    var mockQueryC = getNode(Relay.QL`
      query {
        viewer{actor{id,name}}
      }
    `);

    addPending({query: mockQueryA});
    jest.runAllTimers();

    subtractRelayQuery.mockImplementation(() => null);

    addPending({query: mockQueryB});
    addPending({query: mockQueryC});
    jest.runAllTimers();

    expect(subtractRelayQuery.mock.calls).toEqual([
      [mockQueryB, mockQueryA],
      [mockQueryC, mockQueryA],
    ]);
  });

  it('does not fetch completely subtracted queries', () => {
    var mockQueryA = getNode(Relay.QL`
      query {
        viewer{actor{id,name}}
      }
    `);
    var mockQueryB = getNode(Relay.QL`
      query {
        viewer{actor{id,name}}
      }
    `);

    addPending({query: mockQueryA});
    jest.runAllTimers();

    subtractRelayQuery.mockImplementation((query, subQuery) => {
      expect(query).toBe(mockQueryB);
      expect(subQuery).toBe(mockQueryA);
      return null;
    });

    addPending({query: mockQueryB});
    jest.runAllTimers();

    expect(fetchRelayQuery.mock.calls.length).toBe(1);
    expect(fetchRelayQuery.mock.calls[0][0]).toEqualQueryRoot(mockQueryA);
  });

  it('calls `writeRelayQueryPayload` when receiving data', () => {
    var mockQueryA = getNode(Relay.QL`
      query {
        viewer{actor{id,name}}
      }
    `);
    addPending({query: mockQueryA});
    jest.runAllTimers();

    fetchRelayQuery.mock.requests[0].resolve({});
    jest.runAllTimers();

    var writeCalls = writeRelayQueryPayload.mock.calls;
    expect(writeCalls.length).toBe(1);
    expect(writeCalls[0][1]).toEqualQueryRoot(mockQueryA);
    expect(writeCalls[0][2]).toEqual({});
  });

  it('resolves after dependencies are ready', () => {
    var mockQueryA = getNode(Relay.QL`
      query {
        viewer{actor{id,name}}
      }
    `);
    var mockQueryB = getNode(Relay.QL`
      query {
        viewer{actor{id,name,birthdate{day}}}
      }
    `);
    var mockQueryC = getNode(Relay.QL`
      query {
        viewer{actor{id,birthdate{day}}}
      }
    `);

    var pendingA = addPending({query: mockQueryA});
    var mockSuccessA = jest.genMockFunction();
    pendingA.getResolvedPromise().then(mockSuccessA);

    // Simulates: B - A = C
    subtractRelayQuery.mockImplementation((query, subQuery) => {
      expect(query).toBe(mockQueryB);
      expect(subQuery).toBe(mockQueryA);
      return mockQueryC;
    });

    var pendingB = addPending({query: mockQueryB});
    var mockSuccessB = jest.genMockFunction();
    pendingB.getResolvedPromise().then(mockSuccessB);

    fetchRelayQuery.mock.requests[1].resolve({});
    jest.runAllTimers();

    expect(mockSuccessA).not.toBeCalled();
    expect(mockSuccessB).not.toBeCalled();

    fetchRelayQuery.mock.requests[0].resolve({});
    jest.runAllTimers();

    expect(mockSuccessA).toBeCalled();
    expect(mockSuccessB).toBeCalled();
  });

  it('fails direct dependents and not indirect ones', () => {
    var mockQueryA = getNode(Relay.QL`
      query {
        viewer{actor{id,name}}
      }
    `);
    var mockQueryB = getNode(Relay.QL`
      query {
        viewer{actor{id,name,birthdate{day}}}
      }
    `);
    var mockQueryBPrime = getNode(Relay.QL`
      query {
        viewer{actor{id,birthdate{day}}}
      }
    `);
    var mockQueryC = getNode(Relay.QL`
      query {
        viewer{actor{id,firstName,birthdate{day}}}
      }
    `);
    var mockQueryCPrime = getNode(Relay.QL`
      query {
        viewer{actor{id,firstName,birthdate{day}}}
      }
    `);

    var pendingA = addPending({query: mockQueryA});
    var mockFailureA = jest.genMockFunction();
    pendingA.getResolvedPromise().catch(mockFailureA);
    jest.runAllTimers();

    // Simulates: B - A = B'
    subtractRelayQuery.mockImplementation((query, subQuery) => {
      expect(query).toBe(mockQueryB);
      expect(subQuery).toBe(mockQueryA);
      return mockQueryBPrime;
    });

    var pendingB = addPending({query: mockQueryB});
    var mockFailureB = jest.genMockFunction();
    pendingB.getResolvedPromise().catch(mockFailureB);
    jest.runAllTimers();

    // Simulates: C - A = C, C - B' = C'
    subtractRelayQuery.mockImplementation((query, subQuery) => {
      expect(query).toBe(mockQueryC);
      expect([mockQueryA, mockQueryBPrime]).toContain(subQuery);
      return subQuery === mockQueryA ? mockQueryC : mockQueryCPrime;
    });

    var pendingC = addPending({query: mockQueryC});
    var mockSuccessC = jest.genMockFunction();
    pendingC.getResolvedPromise().then(mockSuccessC);
    jest.runAllTimers();

    var mockFetchError = new Error('Expected `fetchRelayQuery` error.');
    fetchRelayQuery.mock.requests[1].resolve({});
    fetchRelayQuery.mock.requests[0].reject(mockFetchError);
    fetchRelayQuery.mock.requests[2].resolve({});

    jest.runAllTimers();

    var writeCalls = writeRelayQueryPayload.mock.calls;
    expect(writeCalls.length).toBe(2);
    expect(writeCalls[0][1]).toEqualQueryRoot(mockQueryBPrime);
    expect(writeCalls[0][2]).toEqual({});
    expect(writeCalls[1][1]).toEqualQueryRoot(mockQueryCPrime);
    expect(writeCalls[1][2]).toEqual({});

    expect(mockFailureA).toBeCalled();
    expect(mockFailureB).toBeCalled();
    expect(mockSuccessC).toBeCalled();
  });

  it('fails if fetching throws an error', () => {
    var mockQuery = getNode(Relay.QL`
      query {
        viewer{actor{id,name}}
      }
    `);
    var pendingA = addPending({query: mockQuery});
    var mockFailureA = jest.genMockFunction();
    pendingA.getResolvedPromise().catch(mockFailureA);

    var mockError = new Error('Expected error.');
    fetchRelayQuery.mock.requests[0].reject(mockError);
    jest.runAllTimers();

    expect(mockFailureA).toBeCalledWith(mockError);
  });

  it('fails if `writeRelayQueryPayload` throws', () => {
    var mockQuery = getNode(Relay.QL`
      query {
        viewer{actor{id,name}}
      }
    `);
    var pendingA = addPending({query: mockQuery});
    var mockFailureA = jest.genMockFunction();
    pendingA.getResolvedPromise().catch(mockFailureA);

    var mockError = new Error('Expected error.');
    fetchRelayQuery.mock.requests[0].resolve({});
    writeRelayQueryPayload.mockImplementation(() => {
      throw mockError;
    });
    jest.runAllTimers();

    expect(mockFailureA).toBeCalledWith(mockError);
  });

  it('can resolve preload queries *after* they are added', () => {
    var mockQuery = getNode(Relay.QL`
      query {
        viewer{actor{id,name}}
      }
    `);

    addPending({
      query: mockQuery,
      fetchMode: DliteFetchModeConstants.FETCH_MODE_PRELOAD,
    });

    RelayPendingQueryTracker.resolvePreloadQuery(
      mockQuery.getID(),
      {response: {}}
    );

    jest.runAllTimers();

    expect(RelayPendingQueryTracker.hasPendingQueries()).toBeFalsy();
    var writeCalls = writeRelayQueryPayload.mock.calls;
    expect(writeCalls.length).toBe(1);
    expect(writeCalls[0][1]).toEqualQueryRoot(mockQuery);
    expect(writeCalls[0][2]).toEqual({});
  });

  it('can resolve preload queries *before* they are added', () => {
    var mockQuery = getNode(Relay.QL`
      query {
        viewer{actor{id,name}}
      }
    `);

    RelayPendingQueryTracker.resolvePreloadQuery(
      mockQuery.getID(),
      {response: {}}
    );

    addPending({
      query: mockQuery,
      fetchMode: DliteFetchModeConstants.FETCH_MODE_PRELOAD,
    });

    jest.runAllTimers();

    expect(RelayPendingQueryTracker.hasPendingQueries()).toBeFalsy();
    var writeCalls = writeRelayQueryPayload.mock.calls;
    expect(writeCalls.length).toBe(1);
    expect(writeCalls[0][1]).toEqualQueryRoot(mockQuery);
    expect(writeCalls[0][2]).toEqual({});
  });

  it('can reject preloaded pending queries by id', () => {
    var mockQuery = getNode(Relay.QL`
      query {
        viewer{actor{id,name}}
      }
    `);

    var mockPending = addPending({
      query: mockQuery,
      fetchMode: DliteFetchModeConstants.FETCH_MODE_PRELOAD,
    });
    var mockCallback = jest.genMockFunction();
    mockPending.getResolvedPromise().catch(mockCallback);

    var mockError = new Error('Expected error.');
    RelayPendingQueryTracker.rejectPreloadQuery(
      mockQuery.getID(),
      mockError
    );

    jest.runAllTimers();

    expect(RelayPendingQueryTracker.hasPendingQueries()).toBeFalsy();
    expect(mockCallback).toBeCalledWith(mockError);
  });

  it('has pending queries when not queries are all resolved', () => {
    var mockQueryA = getNode(Relay.QL`
      query {
        viewer{actor{id,name}}
      }
    `);
    addPending({query: mockQueryA});
    jest.runAllTimers();

    expect(RelayPendingQueryTracker.hasPendingQueries()).toBeTruthy();
  });

  it('has no pending queries when queries are all resolved', () => {
    var mockQueryA = getNode(Relay.QL`
      query {
        viewer{actor{id,name}}
      }
    `);
    addPending({query: mockQueryA});
    jest.runAllTimers();

    fetchRelayQuery.mock.requests[0].resolve({});
    jest.runAllTimers();

    expect(RelayPendingQueryTracker.hasPendingQueries()).toBeFalsy();
  });

  it('has no pending queries after being reset', () => {
    var mockQueryA = getNode(Relay.QL`
      query {
        viewer{actor{id,name}}
      }
    `);
    addPending({query: mockQueryA});
    jest.runAllTimers();

    RelayPendingQueryTracker.resetPending();

    expect(RelayPendingQueryTracker.hasPendingQueries()).toBeFalsy();
  });
});