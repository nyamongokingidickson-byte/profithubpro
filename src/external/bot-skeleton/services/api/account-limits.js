export default class AccountLimits {
    constructor(store) {
        this.ws = store?.ws;
    }
    // eslint-disable-next-line default-param-last
    getStakePayoutLimits(currency = 'USD', landing_company_shortcode = 'svg', selected_market) {
        const defaultLimits = { min_stake: 0.35, max_payout: 50000 };
        if (!this.ws || typeof this.ws.send !== 'function') {
            return Promise.resolve(defaultLimits);
        }
        return this.ws
            .send({
                landing_company_details: landing_company_shortcode,
            })
            .then(landing_company => {
                const currency_config = landing_company?.landing_company_details?.currency_config?.[selected_market];
                return (currency_config && currency_config[currency]) || defaultLimits;
            })
            .catch(() => defaultLimits);
    }
}
