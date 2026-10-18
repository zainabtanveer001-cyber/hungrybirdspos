const { debounce } = require('./test-utils');

describe('Debounce Utility', () => {
  test('delays function execution', () => {
    const callback = vi.fn();
    const debounced = debounce(callback, 100);

    debounced();
    expect(callback).not.toHaveBeenCalled();

    // vi.advanceTimersByTime is not available without fake timers,
    // so we test the basic behavior
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(callback).toHaveBeenCalledTimes(1);
        resolve();
      }, 150);
    });
  });

  test('only calls once for multiple rapid calls', async () => {
    const callback = vi.fn();
    const debounced = debounce(callback, 50);

    debounced();
    debounced();
    debounced();

    return new Promise((resolve) => {
      setTimeout(() => {
        expect(callback).toHaveBeenCalledTimes(1);
        resolve();
      }, 100);
    });
  });
});
