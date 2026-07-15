export type GoldenPricingScenario =
  | 'identity_collision' | 'asking_only' | 'healthy_market' | 'single_market'
  | 'thin_market' | 'history_spike' | 'low_liquidity' | 'condition_divergence';

export interface GoldenPricingCase {
  set_num: string;
  category: string;
  scenario: GoldenPricingScenario;
}

const groups: Array<[string, GoldenPricingScenario, string[]]> = [
  ['variants', 'identity_collision', ['75188-1','10179-1','10179-2','41999-1','41999-2','77912-1','77912-2','40729-1','40729-2','COMCON-001']],
  ['promos', 'identity_collision', ['4521221-1','SWMP-1','20004-1','4000024-1','4000042-1','SDCC2015-1','CELEB2017-1','5000063-1','5000439-1','TRU001-1']],
  ['multipacks', 'identity_collision', ['65153-1','66712-1','6469-1','1675-1','66456-1','66495-1','66596-1','66674-1','66708-1','66775-1']],
  ['active_retail', 'asking_only', ['10318-1','10300-1','42171-1','43242-1','75379-1','76269-1','21349-1','31212-1','60440-1','71814-1']],
  ['retired', 'healthy_market', ['10182-1','10190-1','10228-1','10255-1','21303-1','75192-1','75252-1','70620-1','75827-1','42056-1']],
  ['vintage', 'single_market', ['6285-1','6286-1','6081-1','6086-1','6991-1','7710-1','7760-1','6980-1','6399-1','497-1']],
  ['high_value', 'healthy_market', ['10123-1','10018-1','10019-1','10026-1','10179-1-HV','4000014-1','4000025-1','4000034-1','852293-1','COMCON-HV']],
  ['thin_markets', 'thin_market', ['792-1','816-1','1427-1','1675-THIN','3482-1','5-4','7174-1','SWMP-THIN','PROMO-THIN','VINTAGE-THIN']],
  ['price_spikes', 'history_spike', ['75188-SPIKE','10123-SPIKE','4521221-SPIKE','10026-SPIKE','4000042-SPIKE','6286-SPIKE','10182-SPIKE','6991-SPIKE','852293-SPIKE','SWMP-SPIKE']],
  ['low_liquidity', 'low_liquidity', ['6285-LIQ','6086-LIQ','10018-LIQ','10190-LIQ','4000024-LIQ','4521221-LIQ','6991-LIQ','7760-LIQ','852293-LIQ','COMCON-LIQ']],
  ['condition_divergence', 'condition_divergence', ['75192-COND','10179-COND','10255-COND','21303-COND','42056-COND','70620-COND','75827-COND','75252-COND','6285-COND','10182-COND']],
];

export const GOLDEN_PRICING_CASES: GoldenPricingCase[] = groups.flatMap(
  ([category, scenario, setNums]) => setNums.map(set_num => ({ set_num, category, scenario })),
);
