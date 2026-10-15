import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Mark } from '@/components/mark';
import { appName, gitConfig, siteUrl } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <Mark size={20} />
          <span className="font-bold tracking-tight">{appName}</span>
        </>
      ),
    },
    links: [{ text: 'observed.software', url: siteUrl, external: true }],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
