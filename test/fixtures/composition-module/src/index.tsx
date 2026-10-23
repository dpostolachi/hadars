import { useState, createContext, useContext } from 'react';
import { Tag } from './tag';

export const Ctx = createContext('unset');

export function Greeting() {
    const [n] = useState(2);
    const who = useContext(Ctx);
    return <p>hello {who} n={n} <Tag /></p>;
}
