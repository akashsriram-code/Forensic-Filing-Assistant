/** A set that forgets its oldest items past a cap, so the record of handled filings never grows without bound. */
export class RingSet {
    private readonly items: string[];
    private readonly lookup: Set<string>;

    constructor(
        private readonly max: number,
        initial: readonly string[] = [],
    ) {
        this.items = initial.slice(-max);
        this.lookup = new Set(this.items);
    }

    has(item: string): boolean {
        return this.lookup.has(item);
    }

    /** True if the item was new. */
    add(item: string): boolean {
        if (this.lookup.has(item)) return false;
        this.items.push(item);
        this.lookup.add(item);
        while (this.items.length > this.max) this.lookup.delete(this.items.shift() as string);
        return true;
    }

    get size(): number {
        return this.items.length;
    }

    toJSON(): string[] {
        return [...this.items];
    }
}
