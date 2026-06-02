import DerivWS from './DerivWS';

export class SubscriptionRegistry {
    private subscriptions = new Map<string, string[]>();

    register(scopeId: string) {
        if (!this.subscriptions.has(scopeId)) this.subscriptions.set(scopeId, []);
        return {
            add: (subId: string) => {
                const list = this.subscriptions.get(scopeId)!;
                list.push(subId);
            },
            dispose: () => {
                const list = this.subscriptions.get(scopeId) || [];
                for (const id of list) DerivWS.unsubscribe(id);
                this.subscriptions.delete(scopeId);
            },
        };
    }
}

export default new SubscriptionRegistry();
