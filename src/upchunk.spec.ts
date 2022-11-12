import { expect } from '@open-wc/testing';
import xhrMock, { sequence, delay } from 'xhr-mock';
import xhr from 'xhr';
import { UpChunk, createUpload, UpChunkOptions } from './upchunk';

describe('integration', () => {
  const endpoint = `https://this-is-a-fake-url.com/upload/endpoint`;
  beforeEach(() => {
    xhrMock.setup();
    /** @ts-ignore */
    xhr.XMLHttpRequest = window.XMLHttpRequest;
  });

  // put the real XHR object back and clear the mocks after each test
  afterEach(() => {
    xhrMock.teardown();
    /** @ts-ignore */
    xhr.XMLHttpRequest = window.XMLHttpRequest;
  });

  const createUploadFixture = (
    options?: Partial<UpChunkOptions>,
    specifiedFile?: File
  ) => {
    const file =
      specifiedFile || new File([new ArrayBuffer(524288)], 'test.mp4');

    return createUpload({
      file,
      endpoint,
      chunkSize: 256,
      ...options,
    });
  };

  it('files can be uploading using POST', (done) => {
    xhrMock.post(endpoint, { status: 200 });

    const upload = createUploadFixture({
      method: 'POST',
    });

    // @ts-ignore
    upload.on('success', () => {
      done();
    });
  });

  it('files can be uploading using PATCH', (done) => {
    xhrMock.patch(endpoint, { status: 200 });

    const upload = createUploadFixture({
      method: 'PATCH',
    });

    upload.on('success', () => {
      done();
    });
  });

  it('a file is uploaded using the correct content-range headers', (done) => {
    let count = 0;
    const fileBytes = 524288;
    const upload = createUploadFixture(
      {},
      new File([new ArrayBuffer(fileBytes)], 'test.mp4')
    );

    xhrMock.put(
      endpoint,
      sequence([
        (req, res) => {
          expect(req.header('Content-range')).to.eql(
            `bytes 0-${fileBytes / 2 - 1}/${fileBytes}`
          );
          count++;
          return res.status(200);
        },
        (req, res) => {
          expect(req.header('Content-range')).to.eql(
            `bytes ${fileBytes / 2}-${fileBytes - 1}/${fileBytes}`
          );
          count++;
          return res.status(200);
        },
      ])
    );

    upload.on('error', (err) => {
      done(err);
    });

    upload.on('success', () => {
      expect(count).to.equal(2);
      done();
    });
  });

  it('an error is thrown if a request does not complete', (done) => {
    xhrMock.put(endpoint, { status: 500 });

    const upload = createUploadFixture();

    upload.on('error', (err) => {
      done();
    });

    upload.on('success', () => {
      done('Ironic failure, should not have been successful');
    });
  });

  it('fires an attempt event before each attempt', (done) => {
    let ATTEMPT_COUNT = 0;
    const MAX_ATTEMPTS = 2; // because we set the chunk size to 256kb, half of our file size in bytes.
    xhrMock.put(endpoint, { status: 200 });

    const upload = createUploadFixture();

    upload.on('attempt', (err) => {
      ATTEMPT_COUNT += 1;
    });

    upload.on('success', () => {
      if (ATTEMPT_COUNT === MAX_ATTEMPTS) {
        done();
      } else {
        done(
          new Error(
            `Attempted ${ATTEMPT_COUNT} times and it should have been ${MAX_ATTEMPTS}`
          )
        );
      }
    });
  });

  it('a chunk failing to upload fires an attemptFailure event', (done) => {
    xhrMock.put(endpoint, { status: 502 });

    const upload = createUploadFixture();

    upload.on('attemptFailure', (err) => {
      upload.pause();
      done();
    });
  });

  it('a single chunk failing is retried multiple times until successful', (done) => {
    let ATTEMPT_FAILURE_COUNT = 0;
    const FAILURES = 2;
    xhrMock.put(endpoint, (req, res) => {
      const status = ATTEMPT_FAILURE_COUNT < FAILURES ? 502 : 200;
      return res.status(status);
    });

    const upload = createUploadFixture({ delayBeforeAttempt: 0.1 });

    upload.on('attemptFailure', (err) => {
      ATTEMPT_FAILURE_COUNT += 1;
    });

    upload.on('error', (evt) => {
      done(new Error('Expected a successful upload, but got an error'));
    });

    upload.on('success', () => {
      if (ATTEMPT_FAILURE_COUNT === FAILURES) {
        return done();
      }

      done(
        new Error(
          `Expected ${FAILURES} attempt failures, received ${ATTEMPT_FAILURE_COUNT}`
        )
      );
    });
  });

  it('a single chunk failing the max number of times fails the upload', (done) => {
    xhrMock.put(
      endpoint,
      sequence([
        { status: 502 },
        { status: 502 },
        { status: 502 },
        { status: 502 },
        { status: 502 },
        { status: 200 },
      ])
    );

    const upload = createUploadFixture({ delayBeforeAttempt: 0.1 });

    upload.on('error', (err) => {
      try {
        expect(err.detail.chunk).to.equal(0);
        expect(err.detail.attempts).to.equal(5);
        done();
      } catch (err) {
        done(err);
      }
    });

    upload.on('success', () => {
      done(new Error(`Expected upload to fail due to failed attempts`));
    });
  });

  it('chunkSuccess event is fired after each successful upload', (done) => {
    let calls = 0;
    xhrMock.put(endpoint, { status: 200 });

    const upload = createUploadFixture();

    upload.on('chunkSuccess', () => {
      calls++;
    });

    upload.on('success', () => {
      expect(calls).to.equal(2);
      done();
    });
  });

  /** @TODO Figure out how to best handle progress testing. See: https://www.npmjs.com/package/xhr-mock#upload-progress (CJP) */
  // const isNumberArraySorted = (a: number[]): boolean => {
  //   for (let i = 0; i < a.length - 1; i += 1) {
  //     if (a[i] > a[i + 1]) {
  //       return false;
  //     }
  //   }
  //   return true;
  // };

  // it('progress event fires the correct upload percentage', (done) => {
  //   const fileBytes = 1048576;
  //   const upload = createUploadFixture(
  //     {},
  //     new File([new ArrayBuffer(fileBytes)], 'test.mp4')
  //   );

  //   const scopes = [
  //     nock('https://example.com')
  //       .matchHeader('content-range', `bytes 0-${fileBytes / 4 - 1}/${fileBytes}`)
  //       .put('/upload/endpoint')
  //       .reply(200),
  //     nock('https://example.com')
  //       .matchHeader(
  //         'content-range',
  //         `bytes ${fileBytes / 4}-${fileBytes / 2 - 1}/${fileBytes}`
  //       )
  //       .put('/upload/endpoint')
  //       .reply(200),
  //     nock('https://example.com')
  //       .matchHeader(
  //         'content-range',
  //         `bytes ${fileBytes / 2}-${3 * fileBytes / 4 - 1}/${fileBytes}`
  //       )
  //       .put('/upload/endpoint')
  //       .reply(200),
  //     nock('https://example.com')
  //       .matchHeader(
  //         'content-range',
  //         `bytes ${3 * fileBytes / 4}-${fileBytes - 1}/${fileBytes}`
  //       )
  //       .put('/upload/endpoint')
  //       .reply(200),
  //   ];

  //   const progressCallback = jest.fn((percentage) => percentage);

  //   upload.on('error', (err) => {
  //     done(err);
  //   });

  //   upload.on('progress', (progress) => {
  //     progressCallback(progress.detail);
  //   });

  //   upload.on('success', () => {
  //     scopes.forEach((scope) => {
  //       if (!scope.isDone()) {
  //         done('All scopes not completed');
  //       }
  //     });
  //     expect(progressCallback).toHaveBeenCalledTimes(4);
  //     const progressPercentageArray = progressCallback.xhrMock.calls.map(([percentage]) => percentage);
  //     expect(isNumberArraySorted(progressPercentageArray)).toBeTruthy();
  //     done();
  //   });
  // }, 10000);

  it('abort pauses the upload and cancels the current XHR request', (done) => {
    let upload: UpChunk;
    let attemptCt = 0;

    // xhrMock.put(endpoint, { status: 200 });
    xhrMock.put(endpoint, delay({ status: 200 }, 1000));

    upload = createUploadFixture();

    upload.on('attempt', () => {
      attemptCt++;
      console.log('attempt!')
      if (attemptCt === 1) {
        upload.abort();
      } else {
        done(new Error(`Error: never should have gotten past attempt 1. Currently attempting ${attemptCt}`));
      }
    });

    upload.on('success', () => done(new Error('Error: should be paused before success but succeeded')));
    // This appears to be called still?
    // upload.on('chunkSuccess', () => done(new Error('Error: should be paused before any chunkSuccess but chunkSuccess')));

    setTimeout(() => {
      expect(upload.paused).to.be.true;
      done();
    }, 50);

  });
});
