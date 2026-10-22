import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import './Header.css';

const Header = ({ user, onLogout }) => {
  const location = useLocation();

  const customerNavItems = [
    { path: '/portal', label: 'My Applications' },
    { path: '/intake', label: 'New Application' },
  ];

  const bankerNavItems = [];

  const navItems = user?.role === 'customer' ? customerNavItems : bankerNavItems;

  const getRoleBadgeColor = (role) => {
    const colors = {
      customer: '#0A4DA2',
      banker: '#E31837',
      ops: '#0284c7',
    };
    return colors[role] || '#6b7280';
  };

  return (
    <header className="header">
      <div className="header-container">
        <div className="logo" style={{ cursor: 'default' }}>
          <div className="logo-icon">
            <img src="/icons/lending-logo.svg" alt="Commercial Lending" style={{width: '36px', height: '36px'}} />
          </div>
          <div className="logo-text">
            <span className="logo-title">LoanProcessAI</span>
            <span className="logo-subtitle">LENDING OPERATIONS</span>
          </div>
        </div>

        <nav className="nav">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          {user && (
            <div className="user-info">
              <span
                className="user-role-badge"
                style={{ backgroundColor: getRoleBadgeColor(user.role) }}
              >
                {user.role === 'customer'
                  ? <img src="/icons/customer-icon.svg" alt="Customer" style={{width: '16px', height: '16px', marginRight: '4px', verticalAlign: 'middle'}} />
                  : user.role === 'banker'
                  ? <img src="/icons/banker-icon.svg" alt="Loan Manager" style={{width: '16px', height: '16px', marginRight: '4px', verticalAlign: 'middle'}} />
                  : <img src="/icons/ops-icon.svg" alt="AI Workflow Explorer" style={{width: '16px', height: '16px', marginRight: '4px', verticalAlign: 'middle'}} />
                }
                {user.role === 'customer'
                  ? 'Customer'
                  : user.role === 'banker'
                    ? 'Loan Manager'
                    : 'AI Workflow Explorer'}
              </span>
              <span className="user-name">{user.name}</span>
            </div>
          )}
          <button className="logout-btn" onClick={onLogout}>
            Logout
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
