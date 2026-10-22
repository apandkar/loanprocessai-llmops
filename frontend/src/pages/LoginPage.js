import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './LoginPage.css';

const LoginPage = ({ onLogin }) => {
  const navigate = useNavigate();
  const [selectedRole, setSelectedRole] = useState(null);
  const [credentials, setCredentials] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);


  const demoUsers = {
    customer: {
      email: 'abc@abc-inc.com',
      password: 'demo123',
      name: 'ABC',
      role: 'customer',
      company: 'ABC, Inc.'
    },
    banker: {
      email: 'rohit.pande@bank.in',
      password: 'demo123',
      name: 'Rohit Pande',
      role: 'banker',
      title: 'Loan Manager'
    }
  };

  const roles = [
    {
      id: 'customer',
      title: 'Customer',
      subtitle: 'Business Owner / Applicant',
      icon: '/icons/customer-icon.svg',
      description: 'Apply for loans, upload documents, track your application status',
      color: '#0A4DA2'
    },
    {
      id: 'banker',
      title: 'Loan Manager',
      subtitle: 'Commercial Lending Operations',
      icon: '/icons/banker-icon.svg',
      description: 'Review applications, run agent analyses, approve or reject deals',
      color: '#E31837'
    }
  ];

  const handleRoleSelect = (roleId) => {
    setSelectedRole(roleId);
    setCredentials({
      email: demoUsers[roleId].email,
      password: demoUsers[roleId].password
    });
    setError('');
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setCredentials(prev => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!selectedRole) {
      setError('Please select a role first');
      return;
    }

    if (!credentials.email || !credentials.password) {
      setError('Please enter email and password');
      return;
    }

    setIsLoading(true);


    await new Promise(resolve => setTimeout(resolve, 1000));

    const user = demoUsers[selectedRole];

    if (credentials.email === user.email && credentials.password === user.password) {
      onLogin(user);


      if (selectedRole === 'customer') {
        navigate('/portal');
      } else {
        navigate('/banker-dashboard');
      }
    } else {
      setError('Invalid credentials. Try the demo credentials shown.');
    }

    setIsLoading(false);
  };

  const handleDemoLogin = (roleId) => {
    setSelectedRole(roleId);
    const user = demoUsers[roleId];
    setCredentials({ email: user.email, password: user.password });

    setTimeout(() => {
      onLogin(user);
      if (roleId === 'customer') {
        navigate('/portal');
      } else {
        navigate('/banker-dashboard');
      }
    }, 500);
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-header">
          <div className="login-logo">
            <img src="/icons/lending-logo.svg" alt="Commercial Lending" style={{width: '50px', height: '50px'}} />
          </div>
          <h1>LoanProcessAI</h1>
          <p>Commercial lending workflow intelligence</p>
        </div>

        <div className="role-selection">
          <h2>Select Your Role</h2>
          <div className="roles-grid">
            {roles.map((role) => (
              <div
                key={role.id}
                className={`role-card ${selectedRole === role.id ? 'selected' : ''}`}
                onClick={() => handleRoleSelect(role.id)}
                style={{ '--role-color': role.color }}
              >
                <div className="role-icon"><img src={role.icon} alt={role.title} className="role-icon-img" /></div>
                <div className="role-info">
                  <h3>{role.title}</h3>
                  {/* <span className="role-subtitle">{role.subtitle}</span> */}
                  <p>{role.description}</p>
                </div>
                <div className="role-check">
                  {selectedRole === role.id && <span>✓</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {selectedRole && (
          <form className="login-form" onSubmit={handleLogin}>
            <h3>Sign In as {roles.find(r => r.id === selectedRole)?.title}</h3>

            {error && (
              <div className="login-error">
                <span>⚠️</span> {error}
              </div>
            )}

            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                name="email"
                value={credentials.email}
                onChange={handleInputChange}
                placeholder="Enter your email"
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                name="password"
                value={credentials.password}
                onChange={handleInputChange}
                placeholder="Enter your password"
                className="form-input"
              />
            </div>

            <button
              type="submit"
              className="login-btn"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <div className="spinner"></div>
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>

            <div className="demo-credentials">
              <span className="demo-label">Demo Credentials:</span>
              <code>{credentials.email} / {credentials.password}</code>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
