import React from 'react';
import { HadarsHead } from 'hadars';
import Code from '../../components/Code';

const RegistrySigning: React.FC = () => (
    <>
        <HadarsHead status={200}>
            <title>Signing and trusted pulls — hadars</title>
            <meta name="description" content="Sign moves to protected registry environments with a team key, and pull only builds that verify against trusted keys." />
            <meta property="og:title" content="Signing and trusted pulls — hadars" />
            <meta property="og:description" content="Only holders of the team's signing key can move production. Pulls verify against keys your project trusts." />
        </HadarsHead>

        <h1 className="text-3xl font-bold mb-3 text-gradient">Signing and trusted pulls</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl">
            A registry token can move environments. A signing key narrows that: once a team has a key, a move to a
            protected environment such as <code className="text-sm bg-muted px-1.5 py-0.5 rounded">production</code>{' '}
            must be signed by it. Projects can also require that what they pull is signed.
        </p>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">1. Create a key</h2>
            <p className="text-muted-foreground mb-4">
                Create the key outside your repository. The private key file is written with mode 600. Keep it out of
                git and out of CI logs.
            </p>
            <Code lang="bash">{`
hadars signing keygen --out ~/.config/hadars/release-signing.json
            `}</Code>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">2. Register the public key</h2>
            <p className="text-muted-foreground mb-4">
                A team admin registers the public key with the registry. Until one is registered, moves are not
                checked. Once one is active, unsigned moves to protected environments are refused. A revoked key stops
                counting immediately.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">3. Sign moves</h2>
            <p className="text-muted-foreground mb-4">
                Pass the key file to a move. The client asks the registry what the move would create, signs exactly
                that result, and then applies it. The signature covers the snapshot and the revision, so it can't be
                reused for a different move.
            </p>
            <Code lang="bash">{`
hadars set production shell@7 --sign-key ~/.config/hadars/release-signing.json
hadars promote staging production --sign-key ~/.config/hadars/release-signing.json
            `}</Code>
            <p className="text-muted-foreground mt-4">
                A move signed with a different key is refused, and so is an unsigned move to a protected environment.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">4. Pull only verified builds</h2>
            <p className="text-muted-foreground mb-4">
                Commit a <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars.trust.json</code> that maps key
                IDs to public keys. <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars pull</code> needs
                trusted keys, and stops before it contacts the registry if it has none. Use{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">--allow-unsigned</code> only for a channel you
                know isn't signed.
            </p>
            <Code lang="typescript">{`
{ "sk_0123456789abcdef": "<base64url public key>" }
            `}</Code>
            <p className="text-muted-foreground mt-4">
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars verify</code> checks the signature of{' '}
                <code className="text-sm bg-muted px-1.5 py-0.5 rounded">hadars.lock</code> against the trusted keys.
            </p>
        </section>

        <section className="mb-10">
            <h2 className="text-xl font-semibold mb-3 text-gradient-soft">Signing in CI</h2>
            <p className="text-muted-foreground mb-4">
                Store the private key as a secret. In the job, write it to a file in the runner's temporary directory,
                pass that path to the move, and delete it when the job ends. Never print it.
            </p>
        </section>
    </>
);

export default RegistrySigning;
