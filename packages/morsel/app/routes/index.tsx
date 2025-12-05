// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import parseDataUrl, { type DataUrl } from "parse-data-url";
import MorselEditor from "~/components/morsel";

export default function Home() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [dataUrl, setDataUrl] = useState<DataUrl | false>(false);
  const [embed, setEmbed] = useState<boolean>(false);
  useEffect(() => {
    if (location.hash.length > 0) setDataUrl(parseDataUrl(location.hash.substring(1)));
    if (searchParams.get("embed") != null) setEmbed(true);
    history.replaceState({}, "", "/");
  }, [location]);
  return <MorselEditor dataUrl={dataUrl ? dataUrl : null} embed={embed} />;
}
