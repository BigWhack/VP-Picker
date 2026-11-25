import { NavLink } from 'react-router-dom';

const LINKS = [['/', 'Today'], ['/sleep', 'Sleep'], ['/heart', 'Heart'], ['/activity', 'Activity'], ['/workouts', 'Workouts'], ['/trends', 'Trends'], ['/settings', 'Settings']] as const;

export function Nav() {
  return (
    <nav className="nav" aria-label="Sections">
      {LINKS.map(([to, label]) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
      ))}
    </nav>
  );
}
