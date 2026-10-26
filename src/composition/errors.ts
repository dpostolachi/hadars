export interface CompositionCompatibilityDetails {
    module: string;
    package?: string;
    requiredRange?: string;
    providedVersion?: string;
    kind: 'version' | 'contract' | 'flavour' | 'shared';
}

/** A version, runtime contract, flavour or shared-package compatibility failure. */
export class CompositionCompatibilityError extends Error implements CompositionCompatibilityDetails {
    readonly module: string;
    readonly package: string | undefined;
    readonly requiredRange: string | undefined;
    readonly providedVersion: string | undefined;
    readonly kind: CompositionCompatibilityDetails['kind'];

    constructor(message: string, details: CompositionCompatibilityDetails) {
        super(message);
        this.name = 'CompositionCompatibilityError';
        this.module = details.module;
        this.package = details.package;
        this.requiredRange = details.requiredRange;
        this.providedVersion = details.providedVersion;
        this.kind = details.kind;
    }
}
