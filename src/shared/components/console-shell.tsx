import { useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Avatar } from 'primereact/avatar';
import { Menu } from 'primereact/menu';
import type { MenuItem } from 'primereact/menuitem';
import { useAuth } from '../../core/auth/auth-context';
import { useUserManagementEnabled } from '../../core/capabilities/use-capabilities';
import { useEnvBar } from '../../core/preferences/env-bar-context';
import { NAV_SIZE_SCALE, useNavPrefs } from '../../core/preferences/nav-prefs-context';
import { environment } from '../../config/environment';
import { sideNavIconClass, sideNavLabelClass, sideNavLinkClass } from './console-nav-classes';

interface SideNavLinkProps {
  to: string;
  end?: boolean;
  /** Either a primeicons class string or a ready-made icon node (brand logo). */
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  sub?: boolean;
}

/** Sidebar navigation link with collapse-aware icon and label. */
export function SideNavLink({ to, end, icon, label, collapsed, sub }: SideNavLinkProps) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : ''}
      className={({ isActive }) => sideNavLinkClass({ active: isActive, collapsed, sub })}
    >
      {({ isActive }) => (
        <>
          {typeof icon === 'string' ? (
            <i className={`${icon} ${sideNavIconClass(isActive)}`}></i>
          ) : (
            icon
          )}
          <span className={sideNavLabelClass(collapsed)}>{label}</span>
        </>
      )}
    </NavLink>
  );
}

interface ConsoleShellProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Header widgets rendered right after the brand block (e.g. project switcher). */
  headerLeft?: ReactNode;
  /** Environment color painted as a strip across the top of the header. */
  accentColor?: string;
  /** Sidebar content; when absent the sidebar rail is not rendered at all
   *  and the content zone takes the full width. */
  nav?: ReactNode;
  navBottom?: ReactNode;
  navBottomAriaLabel?: string;
  children: ReactNode;
}

/** Application chrome shared by the admin and project console: header with
 *  logo and user menu, collapsible sidebar, scrollable content area, footer. */
export function ConsoleShell({
  collapsed,
  onToggleCollapsed,
  headerLeft,
  accentColor,
  nav,
  navBottom,
  navBottomAriaLabel,
  children,
}: ConsoleShellProps) {
  const auth = useAuth();
  const navigate = useNavigate();
  // Identity entry only when the platform manages users/groups (kubauth).
  const userManagement = useUserManagementEnabled();
  const { envBarEnabled } = useEnvBar();
  const { menuSize } = useNavPrefs();
  const menuRef = useRef<Menu>(null);

  const displayName = auth.profile?.firstName ?? auth.profile?.username ?? 'User';
  const first = (auth.profile?.firstName ?? auth.profile?.username ?? '?').charAt(0).toUpperCase();
  const last = (auth.profile?.lastName ?? '').charAt(0).toUpperCase();
  const initials = `${first}${last || ''}`;

  const profileMenu: MenuItem[] = [
    {
      label: 'User Settings',
      icon: 'pi pi-cog',
      command: () => navigate('/settings'),
    },
    // Views is reached from the sidebar world-switcher; /views (redirect)
    // still serves old links.
    ...(auth.hasRole('admins') && userManagement
      ? [
          {
            label: 'Administration',
            icon: 'pi pi-shield',
            command: () => navigate('/admin'),
          },
          {
            label: 'Identity',
            icon: 'pi pi-users',
            command: () => navigate('/identity'),
          },
        ]
      : []),
    ...(auth.hasRole('admins')
      ? [
          {
            label: 'Service Catalog',
            icon: 'pi pi-box',
            command: () => navigate('/catalog'),
          },
        ]
      : []),
    { separator: true },
    {
      label: 'Sign out',
      icon: 'pi pi-sign-out',
      command: () => auth.logout(),
    },
  ];

  const hasSidebar = Boolean(nav);

  return (
    <div
      className={`grid h-screen ${
        hasSidebar
          ? `${
              collapsed
                ? 'grid-cols-[var(--db-sidebar-collapsed-width)_1fr]'
                : 'grid-cols-[var(--db-sidebar-width)_1fr]'
            } max-lg:grid-cols-[var(--db-sidebar-collapsed-width)_1fr] max-md:grid-cols-[1fr]`
          : 'grid-cols-[1fr]'
      } grid-rows-[var(--db-header-height)_minmax(0,1fr)] overflow-hidden bg-surface transition-[grid-template-columns] duration-400 ease-smooth`}
    >
      {/* Unified header */}
      <header className="relative z-20 col-span-full row-start-1 flex h-(--db-header-height) items-center justify-between border-b border-border-light bg-surface px-3 transition-[background-color,border-color] duration-150 ease-smooth">
        {accentColor && envBarEnabled && (
          <div
            className="absolute inset-x-0 top-0 h-[3px]"
            style={{ background: accentColor }}
            aria-hidden="true"
          ></div>
        )}
        {/* The brand zone keeps the expanded-sidebar width in both collapse
            states so the "okdp console" title and the widgets after it never
            shift when the rail below collapses. */}
        <div className="flex w-(--db-sidebar-width) min-w-(--db-sidebar-width) items-center gap-2 max-md:w-auto max-md:min-w-auto">
          <Link to="/home" title="Home" className="flex items-center justify-center no-underline">
            <img src="/images/okdp-notext.svg" alt="okdp" className="h-auto w-6" />
            <div className="ml-2 flex flex-row items-baseline gap-1 leading-none whitespace-nowrap">
              <span className="text-[1.075rem] font-bold tracking-[-0.02em] text-fg">okdp</span>
              <span className="text-[1.075rem] font-normal text-fg-secondary">console</span>
            </div>
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-start gap-2 pl-3">{headerLeft}</div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="User menu"
            className="flex items-center gap-2 rounded-md border-none bg-transparent py-1 pr-2 pl-1 transition-[background-color] duration-150 ease-smooth hover:bg-surface-tertiary"
            onClick={(e) => menuRef.current?.toggle(e)}
          >
            <Avatar
              label={initials}
              shape="circle"
              size="normal"
              style={{
                backgroundColor: 'var(--db-primary)',
                color: '#ffffff',
                fontWeight: 600,
                width: '28px',
                height: '28px',
                fontSize: '0.75rem',
              }}
            />
            <div className="flex flex-col max-md:hidden">
              <span className="text-base leading-none font-medium text-fg">{displayName}</span>
            </div>
            <i className="pi pi-angle-down text-[0.7rem] text-fg-muted"></i>
          </button>
          <Menu ref={menuRef} model={profileMenu} popup />
        </div>
      </header>

      {/* Sidebar — only rendered when the page has menu content (project
          console); other pages get the full-width content zone. */}
      {hasSidebar && (
        /* --nav-item-scale carries the menu-size preference; every entry
           metric in the rail multiplies it. */
        <aside
          style={{ '--nav-item-scale': NAV_SIZE_SCALE[menuSize] } as CSSProperties}
          className="z-[25] col-start-1 row-start-2 flex flex-col border-r border-border-light bg-surface transition-[width] duration-400 ease-smooth max-md:hidden"
        >
          {/* The sidebar is fixed with the shell. When the viewport is too
            short for the tree, the nav zone itself slides (scrolls) while
            the bottom collapse bar stays pinned. */}
          <nav
            className={`mt-0 min-h-0 flex-1 overflow-y-auto ${
              collapsed ? 'px-[0.4rem] py-3' : 'py-2 pr-1.5 pl-0 max-lg:px-[0.4rem] max-lg:py-3'
            }`}
          >
            {nav}
          </nav>
          {navBottom && (
            <nav
              className={`shrink-0 border-t border-border-light ${
                collapsed
                  ? 'px-[0.4rem] pt-2 pb-3'
                  : 'pt-1.5 pr-1.5 pb-2 pl-0 max-lg:px-[0.4rem] max-lg:pt-2 max-lg:pb-3'
              }`}
              aria-label={navBottomAriaLabel}
            >
              {navBottom}
            </nav>
          )}
          {/* Bottom collapse bar — pinned at the bottom of the rail. */}
          <div className="mt-auto flex shrink-0 border-t border-border-light p-1.5">
            <button
              className={`flex h-8 items-center justify-center rounded-md border-none bg-transparent text-fg-muted transition-[color,background-color] duration-150 ease-smooth hover:bg-surface-tertiary hover:text-fg ${
                collapsed ? 'w-full' : 'ml-auto w-8 max-lg:w-full'
              }`}
              onClick={onToggleCollapsed}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <i
                className={`pi ${collapsed ? 'pi-angle-double-right' : 'pi-angle-double-left'} text-[1rem]`}
              ></i>
            </button>
          </div>
        </aside>
      )}

      {/* Main layout */}
      <div
        className={`row-start-2 m-0 flex h-full flex-col overflow-visible bg-surface-secondary transition-[background-color,border-color] duration-150 ease-smooth ${
          hasSidebar ? 'col-start-2 max-md:col-start-1' : 'col-start-1'
        }`}
      >
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-0">
          <div className="flex w-full min-w-0 flex-1 flex-col px-7 py-5 max-lg:px-5 max-lg:py-3 max-md:p-3">
            {children}
          </div>
        </main>

        <footer className="flex min-h-7 w-full shrink-0 items-center justify-between border-t border-border-light bg-transparent px-7 py-1.5">
          <div className="flex items-center gap-3">
            <span className="text-xs font-normal text-fg-muted">
              © {new Date().getFullYear()} OKDP. All rights reserved.
            </span>
            <a
              href={environment.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs font-normal text-fg-muted no-underline transition-colors duration-150 ease-smooth hover:text-fg"
            >
              <i className="pi pi-github text-[0.8rem]"></i>
              GitHub
            </a>
          </div>
          <div>
            <span className="text-xs font-normal text-fg-muted">{`v${__APP_VERSION__}`}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
