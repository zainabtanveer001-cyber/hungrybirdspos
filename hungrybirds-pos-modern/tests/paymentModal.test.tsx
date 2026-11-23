import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PaymentModal } from '../src/components/PaymentModal';

describe('PaymentModal alignment', () => {
  it('aligns Cash Received label to the right above the right-aligned cash input', () => {
    const html = renderToStaticMarkup(
      <PaymentModal total={360} onCancel={() => {}} onConfirm={() => {}} />,
    );

    expect(html).toMatch(/<label[^>]*for="cashGiven"[^>]*text-right[^>]*>Cash Received \(Rs\)<\/label>/);
  });
});
