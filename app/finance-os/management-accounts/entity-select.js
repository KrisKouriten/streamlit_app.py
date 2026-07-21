"use client";

import { useRouter, useSearchParams } from "next/navigation";

// Entity picker for the board-pack P&L — navigates via ?entity=<key>, scrolling
// preserved so the section stays in view on change.
export default function EntitySelect({ catalogue, selected }) {
  const router = useRouter();
  const params = useSearchParams();

  const onChange = (e) => {
    const sp = new URLSearchParams(params);
    sp.set("entity", e.target.value);
    router.replace(`?${sp.toString()}#entity-pl`, { scroll: false });
  };

  const stores = catalogue.filter((c) => c.kind === "store");
  const franchise = catalogue.filter((c) => c.kind === "franchise");
  const other = catalogue.filter((c) => c.kind === "generic");

  return (
    <select className="fos-input" value={selected} onChange={onChange} style={{ maxWidth: 320, fontSize: 13 }} aria-label="Select entity">
      <optgroup label="Stores">
        {stores.map((c) => <option key={c.key} value={c.key}>{c.display}</option>)}
      </optgroup>
      {franchise.length > 0 && (
        <optgroup label="Franchise">
          {franchise.map((c) => <option key={c.key} value={c.key}>{c.display}</option>)}
        </optgroup>
      )}
      {other.length > 0 && (
        <optgroup label="Head Office & other entities">
          {other.map((c) => <option key={c.key} value={c.key}>{c.display}</option>)}
        </optgroup>
      )}
    </select>
  );
}
