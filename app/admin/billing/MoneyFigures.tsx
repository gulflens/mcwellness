import type { MonthlyMoneyResponse } from '../../api/billing/document-schema';
import { formatFils } from './money';

/**
 * Three facts about the month, side by side, and nothing else
 * (docs/SPEC/billing.md section 4.1).
 *
 * They sit together because apart they mislead. Cash collected is what came in;
 * revenue recognised is what was actually earned by delivering; the third is
 * what the practice still owes in sessions. Ten programmes sold in a launch
 * month is a great deal of money in the bank and roughly six months of work
 * owed, and only the three together say so.
 *
 * **Two of them are net and one is gross, and each says which.** Cash collected
 * is money that arrived, VAT and all; revenue recognised and the deferred
 * balance are allocated net values off the entitlement ledger. Set side by side
 * without saying so — which is how they first shipped — they read as three
 * figures on one basis, and the arithmetic a reader would do between them would
 * be wrong. Today the practice charges no VAT, so the three happen to be on the
 * same basis; the labels are for the day it registers, which is the day nobody
 * will re-read this component.
 *
 * Quiet on purpose: three figures in the same shape the balances panel uses, no
 * charts, no trend arrows, no comparison with last month. Nothing here is
 * trying to be a dashboard.
 */
export function MoneyFigures({ figures }: { figures: MonthlyMoneyResponse }) {
  return (
    <dl className="figures">
      <div className="figures__item">
        <dt>Cash collected this month (AED)</dt>
        <dd className="numeric">{formatFils(figures.cashCollectedFils)}</dd>
        <dd className="small muted">What arrived, including any VAT</dd>
      </div>
      <div className="figures__item">
        <dt>Revenue recognised (AED)</dt>
        <dd className="numeric">{formatFils(figures.revenueRecognisedFils)}</dd>
        <dd className="small muted">Earned by delivering, net of VAT</dd>
      </div>
      <div className="figures__item">
        <dt>Owed in sessions (AED)</dt>
        <dd className="numeric">{formatFils(figures.deferredNetFils)}</dd>
        {/* What the third figure is, in the words the spec uses for it. */}
        <dd className="small muted">Paid for, not yet delivered, net of VAT</dd>
      </div>
    </dl>
  );
}
