import { Heading } from "@primer/react";
import React from "react";
import { useParams } from "react-router-dom";
import Box from "../components/Box";

const FollowersPage: React.FC = () => {
  const { username } = useParams();

  return (
    <Box p={4}>
      <Heading as="h2">Followers of @{username}</Heading>
    </Box>
  );
};

export default FollowersPage;
