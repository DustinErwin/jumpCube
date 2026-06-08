import { render, screen } from '@testing-library/react';
import App from './App';

/*
 * Legacy starter test.
 *
 * This assertion still references the default React template text and should be
 * replaced with an app-specific smoke test before relying on the test suite.
 */
test('renders learn react link', () => {
  render(<App />);
  const linkElement = screen.getByText(/learn react/i);
  expect(linkElement).toBeInTheDocument();
});
