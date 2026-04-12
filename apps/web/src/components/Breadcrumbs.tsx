import { ChevronRightIcon } from "@primer/octicons-react";
import React from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";

const Nav = styled.nav`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
`;

const BreadcrumbLink = styled(Link)`
  color: var(--color-text-muted);
  text-decoration: none;
  transition: color 0.15s;

  &:hover {
    color: var(--color-text-primary);
    text-decoration: underline;
  }
`;

const CurrentItem = styled.span`
  color: var(--color-text-primary);
  font-weight: 500;
`;

const Chevron = styled(ChevronRightIcon)`
  color: var(--color-text-tertiary);
  flex-shrink: 0;
`;

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

const Breadcrumbs: React.FC<{ items: BreadcrumbItem[] }> = ({ items }) => (
  <Nav aria-label="Breadcrumbs">
    {items.map((item, i) => {
      const isLast = i === items.length - 1;
      return (
        <React.Fragment key={i}>
          {i > 0 && <Chevron size={14} />}
          {isLast || !item.href ? (
            <CurrentItem>{item.label}</CurrentItem>
          ) : (
            <BreadcrumbLink to={item.href}>{item.label}</BreadcrumbLink>
          )}
        </React.Fragment>
      );
    })}
  </Nav>
);

export default Breadcrumbs;
