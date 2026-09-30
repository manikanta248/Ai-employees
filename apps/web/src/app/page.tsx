import { redirect } from 'next/navigation';
import { DEFAULT_LOCALE } from '@hazir/i18n';

export default function Home() {
  redirect(`/${DEFAULT_LOCALE}/design`);
}
